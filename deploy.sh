#!/bin/bash

# ============================================================================
# Rook Game - Quick Deploy Script
# ============================================================================
# Deploys backend and/or frontend to AWS with a single command.
#
# Usage:
#   ./deploy.sh           # Deploy everything (backend + frontend)
#   ./deploy.sh backend   # Deploy only backend
#   ./deploy.sh frontend  # Deploy only frontend
#   ./deploy.sh --skip-build  # Deploy without rebuilding (faster)
# ============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_NAME="rook-game"
REGION="us-east-1"
BUCKET_NAME="rook-game-frontend-947645751634"
DISTRIBUTION_ID="E1949AV8JLTDDZ"

# URLs (will be updated after backend deploy)
HTTP_API_URL="https://698u4fhbeg.execute-api.us-east-1.amazonaws.com"
WS_API_URL="wss://he75v1ijt1.execute-api.us-east-1.amazonaws.com/prod"
FRONTEND_URL="https://dqpvq96b4f93p.cloudfront.net"

# Parse arguments
DEPLOY_BACKEND=true
DEPLOY_FRONTEND=true
SKIP_BUILD=false

for arg in "$@"; do
  case $arg in
    backend)
      DEPLOY_FRONTEND=false
      ;;
    frontend)
      DEPLOY_BACKEND=false
      ;;
    --skip-build)
      SKIP_BUILD=true
      ;;
    --help|-h)
      echo "Usage: ./deploy.sh [backend|frontend] [--skip-build]"
      echo ""
      echo "Options:"
      echo "  backend      Deploy only the backend (Lambda + API Gateway)"
      echo "  frontend     Deploy only the frontend (S3 + CloudFront)"
      echo "  --skip-build Skip the build step (use existing build artifacts)"
      echo ""
      echo "Examples:"
      echo "  ./deploy.sh              # Deploy everything"
      echo "  ./deploy.sh backend      # Deploy only backend"
      echo "  ./deploy.sh frontend     # Deploy only frontend"
      echo "  ./deploy.sh --skip-build # Deploy without rebuilding"
      exit 0
      ;;
  esac
done

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              🚀 Rook Game - Deploy to AWS                     ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

START_TIME=$(date +%s)

# ============================================================================
# Deploy Backend
# ============================================================================
if [ "$DEPLOY_BACKEND" = true ]; then
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}  Backend Deployment${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  cd "$SCRIPT_DIR/backend"
  
  if [ "$SKIP_BUILD" = false ]; then
    echo -e "${YELLOW}Building SAM application...${NC}"
    rm -rf .aws-sam 2>/dev/null || true
    
    # Source SAM environment if available
    source ~/.samdev.env 2>/dev/null || true
    
    sam build 2>&1 | tail -5
    echo -e "${GREEN}✓ Build complete${NC}"
  else
    echo -e "${YELLOW}Skipping build (using existing artifacts)${NC}"
  fi
  
  echo -e "${YELLOW}Deploying to AWS...${NC}"
  
  # Deploy and capture output
  DEPLOY_OUTPUT=$(sam deploy \
    --stack-name $STACK_NAME \
    --capabilities CAPABILITY_IAM \
    --resolve-s3 \
    --no-confirm-changeset \
    --no-fail-on-empty-changeset \
    --region $REGION 2>&1)
  
  # Extract URLs from output
  HTTP_API_URL=$(echo "$DEPLOY_OUTPUT" | grep -o 'https://[a-z0-9]*\.execute-api\.[a-z0-9-]*\.amazonaws\.com' | head -1)
  WS_API_URL=$(echo "$DEPLOY_OUTPUT" | grep -o 'wss://[a-z0-9]*\.execute-api\.[a-z0-9-]*\.amazonaws\.com/prod' | head -1)
  
  echo -e "${GREEN}✓ Backend deployed${NC}"
  echo -e "  HTTP API: ${CYAN}${HTTP_API_URL}${NC}"
  echo -e "  WebSocket: ${CYAN}${WS_API_URL}${NC}"
  echo ""
fi

# ============================================================================
# Deploy Frontend
# ============================================================================
if [ "$DEPLOY_FRONTEND" = true ]; then
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}  Frontend Deployment${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  cd "$SCRIPT_DIR/frontend"
  
  if [ "$SKIP_BUILD" = false ]; then
    echo -e "${YELLOW}Building React application...${NC}"
    
    REACT_APP_API_BASE_URL="$HTTP_API_URL" \
    REACT_APP_WS_BASE_URL="$WS_API_URL" \
    npm run build --silent 2>/dev/null
    
    echo -e "${GREEN}✓ Build complete${NC}"
  else
    echo -e "${YELLOW}Skipping build (using existing artifacts)${NC}"
  fi
  
  echo -e "${YELLOW}Uploading to S3...${NC}"
  aws s3 sync build/ "s3://${BUCKET_NAME}" --delete --quiet
  echo -e "${GREEN}✓ Uploaded to S3${NC}"
  
  echo -e "${YELLOW}Invalidating CloudFront cache...${NC}"
  INVALIDATION_ID=$(aws cloudfront create-invalidation \
    --distribution-id $DISTRIBUTION_ID \
    --paths "/*" \
    --query 'Invalidation.Id' \
    --output text)
  echo -e "${GREEN}✓ Cache invalidated (ID: ${INVALIDATION_ID})${NC}"
  echo ""
fi

# ============================================================================
# Summary
# ============================================================================
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✅ Deployment Complete! (${DURATION}s)${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${BLUE}Frontend:${NC}  ${CYAN}${FRONTEND_URL}${NC}"
echo -e "  ${BLUE}HTTP API:${NC}  ${CYAN}${HTTP_API_URL}${NC}"
echo -e "  ${BLUE}WebSocket:${NC} ${CYAN}${WS_API_URL}${NC}"
echo ""
echo -e "  ${YELLOW}Note: CloudFront may take 1-2 minutes to propagate changes.${NC}"
echo -e "  ${YELLOW}Hard refresh (Ctrl+Shift+R) to see updates immediately.${NC}"
echo ""
