#!/bin/bash

# Deploy Rook Frontend to AWS (S3 + CloudFront)
# This script builds the React app and deploys it to S3 with CloudFront

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
ENV_FILE="$SCRIPT_DIR/.deployment-env"

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║            🌐 ROOK FRONTEND AWS DEPLOYMENT                ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"

if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI is not installed. Please install AWS CLI first.${NC}"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed. Please install Node.js 18+.${NC}"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}❌ AWS credentials not configured. Please run 'aws configure'.${NC}"
    exit 1
fi

# Check if backend deployment file exists
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}⚠️  Backend deployment file (.deployment-env) not found.${NC}"
    echo -e "${YELLOW}   Please deploy the backend first using deploy-backend.sh${NC}"
    exit 1
fi

# Load deployment URLs
source "$ENV_FILE"

if [ -z "$REACT_APP_API_BASE_URL" ] || [ -z "$REACT_APP_WS_BASE_URL" ]; then
    echo -e "${RED}❌ API URLs not found in deployment file.${NC}"
    echo -e "${RED}   Please deploy the backend first.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Prerequisites check passed${NC}"
echo -e "${BLUE}Using API URLs from backend deployment:${NC}"
echo -e "  HTTP API: ${GREEN}$REACT_APP_API_BASE_URL${NC}"
echo -e "  WebSocket: ${GREEN}$REACT_APP_WS_BASE_URL${NC}"
echo ""

# Navigate to frontend directory
cd "$FRONTEND_DIR"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}Installing frontend dependencies...${NC}"
    npm install
else
    echo -e "${GREEN}✓ Dependencies already installed${NC}"
fi

# Build React app with production environment variables
echo -e "${BLUE}Building React app for production...${NC}"
REACT_APP_API_BASE_URL="$REACT_APP_API_BASE_URL" \
REACT_APP_WS_BASE_URL="$REACT_APP_WS_BASE_URL" \
npm run build

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Build successful${NC}"
echo ""

# Determine S3 bucket name
STACK_NAME="${STACK_NAME:-rook-game}"
BUCKET_NAME="${BUCKET_NAME:-${STACK_NAME}-frontend-$(aws sts get-caller-identity --query Account --output text)}"

# Check if bucket exists, create if not
echo -e "${BLUE}Checking S3 bucket: $BUCKET_NAME${NC}"

if ! aws s3 ls "s3://$BUCKET_NAME" &> /dev/null; then
    echo -e "${YELLOW}Bucket does not exist. Creating...${NC}"
    
    # Determine region
    REGION="${REGION:-us-east-1}"
    
    if [ "$REGION" = "us-east-1" ]; then
        aws s3 mb "s3://$BUCKET_NAME" --region "$REGION"
    else
        aws s3 mb "s3://$BUCKET_NAME" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION"
    fi
    
    # Enable static website hosting
    aws s3 website "s3://$BUCKET_NAME" \
        --index-document index.html \
        --error-document index.html
    
    # Set bucket policy for CloudFront (we'll use CloudFront, so keep private)
    echo -e "${GREEN}✓ Bucket created${NC}"
else
    echo -e "${GREEN}✓ Bucket exists${NC}"
fi

# Upload build files
echo -e "${BLUE}Uploading build files to S3...${NC}"
aws s3 sync build/ "s3://$BUCKET_NAME" --delete

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Upload failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Files uploaded${NC}"
echo ""

# Check if CloudFront distribution exists
echo -e "${BLUE}Checking CloudFront distribution...${NC}"

DIST_ID=$(aws cloudfront list-distributions \
    --query "DistributionList.Items[?Comment==\`${STACK_NAME}-frontend\`].Id" \
    --output text 2>/dev/null || echo "")

if [ -z "$DIST_ID" ]; then
    echo -e "${YELLOW}CloudFront distribution does not exist. Creating...${NC}"
    echo -e "${YELLOW}This will take 15-20 minutes. Please wait...${NC}"
    
    # Create CloudFront distribution
    REGION="${REGION:-us-east-1}"
    BUCKET_DOMAIN="$BUCKET_NAME.s3.$REGION.amazonaws.com"
    
    # Create distribution config
    DIST_CONFIG=$(cat <<EOF
{
  "CallerReference": "${STACK_NAME}-frontend-$(date +%s)",
  "Comment": "${STACK_NAME}-frontend",
  "DefaultCacheBehavior": {
    "TargetOriginId": "S3-${BUCKET_NAME}",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 2,
      "Items": ["GET", "HEAD"],
      "CachedMethods": {
        "Quantity": 2,
        "Items": ["GET", "HEAD"]
      }
    },
    "ForwardedValues": {
      "QueryString": false,
      "Cookies": {"Forward": "none"}
    },
    "MinTTL": 0,
    "DefaultTTL": 86400,
    "MaxTTL": 31536000,
    "Compress": true
  },
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "S3-${BUCKET_NAME}",
        "DomainName": "${BUCKET_DOMAIN}",
        "S3OriginConfig": {
          "OriginAccessIdentity": ""
        }
      }
    ]
  },
  "Enabled": true,
  "DefaultRootObject": "index.html",
  "CustomErrorResponses": {
    "Quantity": 1,
    "Items": [
      {
        "ErrorCode": 404,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 300
      }
    ]
  }
}
EOF
)
    
    DIST_OUTPUT=$(aws cloudfront create-distribution --distribution-config "$DIST_CONFIG")
    DIST_ID=$(echo "$DIST_OUTPUT" | grep -o '"Id": "[^"]*' | cut -d'"' -f4)
    
    echo -e "${GREEN}✓ CloudFront distribution created: $DIST_ID${NC}"
    echo -e "${YELLOW}⚠️  Distribution is deploying. This takes 15-20 minutes.${NC}"
    echo -e "${YELLOW}   Run this script again later to get the final URL.${NC}"
    
    # Save distribution ID
    echo "DISTRIBUTION_ID=$DIST_ID" >> "$ENV_FILE"
    
    # Wait a bit and check status
    echo -e "${BLUE}Waiting for distribution to be ready...${NC}"
    sleep 10
    
    STATUS=$(aws cloudfront get-distribution --id "$DIST_ID" --query 'Distribution.Status' --output text 2>/dev/null || echo "InProgress")
    
    if [ "$STATUS" = "Deployed" ]; then
        DIST_DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" --query 'Distribution.DomainName' --output text 2>/dev/null || echo "")
        FRONTEND_URL="https://$DIST_DOMAIN"
    else
        FRONTEND_URL="https://$DIST_ID.cloudfront.net (deploying...)"
    fi
else
    echo -e "${GREEN}✓ CloudFront distribution exists: $DIST_ID${NC}"
    
    # Invalidate cache
    echo -e "${BLUE}Invalidating CloudFront cache...${NC}"
    INVALIDATION_ID=$(aws cloudfront create-invalidation \
        --distribution-id "$DIST_ID" \
        --paths "/*" \
        --query 'Invalidation.Id' \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$INVALIDATION_ID" ]; then
        echo -e "${GREEN}✓ Cache invalidation created: $INVALIDATION_ID${NC}"
    fi
    
    # Get distribution domain
    DIST_DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" --query 'Distribution.DomainName' --output text 2>/dev/null || echo "")
    FRONTEND_URL="https://$DIST_DOMAIN"
fi

echo ""
echo -e "${GREEN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║            ✅ FRONTEND DEPLOYMENT COMPLETE                 ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║                                                           ║"
echo "║   Frontend URL:  $FRONTEND_URL"
echo "║                                                           ║"
if [ -n "$DIST_ID" ] && [ "$STATUS" != "Deployed" ]; then
    echo "║   ⚠️  CloudFront is still deploying. Check status with:    ║"
    echo "║      aws cloudfront get-distribution --id $DIST_ID    ║"
fi
echo "║                                                           ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
