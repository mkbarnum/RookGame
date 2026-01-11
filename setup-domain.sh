#!/bin/bash

# ============================================================================
# Rook Game - Custom Domain Setup Script
# ============================================================================
# This script sets up a custom domain for your Rook game deployment.
# 
# Prerequisites:
# - AWS CLI configured with appropriate permissions
# - Domain registered and DNS accessible (Route 53 or external provider)
# - Existing Rook deployment (run deploy.sh first)
#
# Usage: ./setup-domain.sh yourdomain.com
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_ENV="$SCRIPT_DIR/.deployment-env"
REGION="us-east-1"

# Load existing deployment info
if [ -f "$DEPLOYMENT_ENV" ]; then
    source "$DEPLOYMENT_ENV"
else
    echo -e "${RED}Error: .deployment-env not found. Run the deployment first.${NC}"
    exit 1
fi

# Get domain from argument or prompt
DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
    echo -e "${CYAN}Enter your domain name (e.g., example.com):${NC}"
    read -r DOMAIN
fi

if [ -z "$DOMAIN" ]; then
    echo -e "${RED}Error: Domain name is required${NC}"
    exit 1
fi

# Subdomains configuration
FRONTEND_SUBDOMAIN="play"
API_SUBDOMAIN="api"
WS_SUBDOMAIN="ws"

FRONTEND_DOMAIN="${FRONTEND_SUBDOMAIN}.${DOMAIN}"
API_DOMAIN="${API_SUBDOMAIN}.${DOMAIN}"
WS_DOMAIN="${WS_SUBDOMAIN}.${DOMAIN}"

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                     Rook Game - Custom Domain Setup                           ║${NC}"
echo -e "${BLUE}╠═══════════════════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║${NC}                                                                               ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  Domain:     ${GREEN}${DOMAIN}${NC}"
echo -e "${BLUE}║${NC}  Frontend:   ${GREEN}${FRONTEND_DOMAIN}${NC}"
echo -e "${BLUE}║${NC}  API:        ${GREEN}${API_DOMAIN}${NC}"
echo -e "${BLUE}║${NC}  WebSocket:  ${GREEN}${WS_DOMAIN}${NC}"
echo -e "${BLUE}║${NC}                                                                               ${BLUE}║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${YELLOW}Continue with this configuration? (y/n)${NC}"
read -r CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# ============================================================================
# Step 1: Request SSL Certificate
# ============================================================================
echo ""
echo -e "${CYAN}Step 1: Requesting SSL Certificate...${NC}"

# Check if certificate already exists
EXISTING_CERT=$(aws acm list-certificates --region $REGION \
    --query "CertificateSummaryList[?DomainName=='${DOMAIN}'].CertificateArn" \
    --output text 2>/dev/null || echo "")

if [ -n "$EXISTING_CERT" ] && [ "$EXISTING_CERT" != "None" ]; then
    echo -e "${GREEN}Certificate already exists: ${EXISTING_CERT}${NC}"
    CERT_ARN="$EXISTING_CERT"
else
    # Request new certificate
    CERT_ARN=$(aws acm request-certificate \
        --domain-name "$DOMAIN" \
        --subject-alternative-names "*.${DOMAIN}" \
        --validation-method DNS \
        --region $REGION \
        --query 'CertificateArn' \
        --output text)
    
    echo -e "${GREEN}Certificate requested: ${CERT_ARN}${NC}"
fi

# Wait a moment for certificate details to be available
sleep 5

# Get validation records
echo ""
echo -e "${CYAN}Getting DNS validation records...${NC}"

VALIDATION_INFO=$(aws acm describe-certificate \
    --certificate-arn "$CERT_ARN" \
    --region $REGION \
    --query 'Certificate.DomainValidationOptions[0]')

VALIDATION_NAME=$(echo "$VALIDATION_INFO" | grep -o '"Name": "[^"]*' | cut -d'"' -f4)
VALIDATION_VALUE=$(echo "$VALIDATION_INFO" | grep -o '"Value": "[^"]*' | cut -d'"' -f4)
VALIDATION_STATUS=$(echo "$VALIDATION_INFO" | grep -o '"ValidationStatus": "[^"]*' | cut -d'"' -f4)

if [ "$VALIDATION_STATUS" == "SUCCESS" ]; then
    echo -e "${GREEN}Certificate is already validated!${NC}"
else
    echo ""
    echo -e "${YELLOW}╔═══════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║  ADD THIS DNS RECORD TO VALIDATE YOUR CERTIFICATE                             ║${NC}"
    echo -e "${YELLOW}╠═══════════════════════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${YELLOW}║${NC}"
    echo -e "${YELLOW}║${NC}  Type:   ${GREEN}CNAME${NC}"
    echo -e "${YELLOW}║${NC}  Name:   ${GREEN}${VALIDATION_NAME}${NC}"
    echo -e "${YELLOW}║${NC}  Value:  ${GREEN}${VALIDATION_VALUE}${NC}"
    echo -e "${YELLOW}║${NC}"
    echo -e "${YELLOW}╚═══════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    # Check if using Route 53
    echo -e "${CYAN}Is your domain hosted in Route 53? (y/n)${NC}"
    read -r USE_ROUTE53
    
    if [[ "$USE_ROUTE53" =~ ^[Yy]$ ]]; then
        # Get hosted zone ID
        HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name \
            --dns-name "$DOMAIN" \
            --query "HostedZones[?Name=='${DOMAIN}.'].Id" \
            --output text | sed 's|/hostedzone/||')
        
        if [ -n "$HOSTED_ZONE_ID" ] && [ "$HOSTED_ZONE_ID" != "None" ]; then
            echo -e "${CYAN}Found hosted zone: ${HOSTED_ZONE_ID}${NC}"
            echo -e "${CYAN}Adding validation record automatically...${NC}"
            
            aws route53 change-resource-record-sets \
                --hosted-zone-id "$HOSTED_ZONE_ID" \
                --change-batch '{
                    "Changes": [{
                        "Action": "UPSERT",
                        "ResourceRecordSet": {
                            "Name": "'"$VALIDATION_NAME"'",
                            "Type": "CNAME",
                            "TTL": 300,
                            "ResourceRecords": [{"Value": "'"$VALIDATION_VALUE"'"}]
                        }
                    }]
                }' > /dev/null
            
            echo -e "${GREEN}Validation record added to Route 53!${NC}"
        else
            echo -e "${YELLOW}Hosted zone not found. Please add the DNS record manually.${NC}"
        fi
    else
        echo -e "${YELLOW}Please add the DNS record above to your DNS provider.${NC}"
    fi
    
    echo ""
    echo -e "${CYAN}Waiting for certificate validation (this may take a few minutes)...${NC}"
    echo -e "${CYAN}Press Ctrl+C to cancel and run this script again later.${NC}"
    
    # Wait for certificate validation
    aws acm wait certificate-validated \
        --certificate-arn "$CERT_ARN" \
        --region $REGION
    
    echo -e "${GREEN}Certificate validated successfully!${NC}"
fi

# ============================================================================
# Step 2: Get existing CloudFront distribution config
# ============================================================================
echo ""
echo -e "${CYAN}Step 2: Updating CloudFront distribution...${NC}"

# Get the CloudFront distribution ID from deployment env or find it
if [ -z "$DISTRIBUTION_ID" ]; then
    DISTRIBUTION_ID=$(aws cloudfront list-distributions \
        --query "DistributionList.Items[?Comment=='rook-game-frontend'].Id" \
        --output text)
fi

if [ -z "$DISTRIBUTION_ID" ] || [ "$DISTRIBUTION_ID" == "None" ]; then
    echo -e "${RED}Error: CloudFront distribution not found${NC}"
    exit 1
fi

echo -e "${CYAN}Distribution ID: ${DISTRIBUTION_ID}${NC}"

# Get current config
ETAG=$(aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID" \
    --query 'ETag' --output text)

aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID" \
    --query 'DistributionConfig' > /tmp/cf-config.json

# Update the config with custom domain
cat /tmp/cf-config.json | jq --arg domain "$FRONTEND_DOMAIN" --arg cert "$CERT_ARN" '
    .Aliases = {"Quantity": 1, "Items": [$domain]} |
    .ViewerCertificate = {
        "ACMCertificateArn": $cert,
        "SSLSupportMethod": "sni-only",
        "MinimumProtocolVersion": "TLSv1.2_2021",
        "Certificate": $cert,
        "CertificateSource": "acm"
    }
' > /tmp/cf-config-updated.json

# Update the distribution
aws cloudfront update-distribution \
    --id "$DISTRIBUTION_ID" \
    --if-match "$ETAG" \
    --distribution-config file:///tmp/cf-config-updated.json > /dev/null

echo -e "${GREEN}CloudFront distribution updated with custom domain!${NC}"

# ============================================================================
# Step 3: Create custom domain for HTTP API
# ============================================================================
echo ""
echo -e "${CYAN}Step 3: Setting up custom domain for HTTP API...${NC}"

# Extract API ID from URL
HTTP_API_ID=$(echo "$REACT_APP_API_BASE_URL" | sed 's|https://||' | cut -d'.' -f1)

# Check if domain already exists
EXISTING_API_DOMAIN=$(aws apigatewayv2 get-domain-name \
    --domain-name "$API_DOMAIN" 2>/dev/null || echo "")

if [ -z "$EXISTING_API_DOMAIN" ]; then
    # Create custom domain
    API_DOMAIN_CONFIG=$(aws apigatewayv2 create-domain-name \
        --domain-name "$API_DOMAIN" \
        --domain-name-configurations CertificateArn="$CERT_ARN")
    
    API_TARGET=$(echo "$API_DOMAIN_CONFIG" | grep -o '"ApiGatewayDomainName": "[^"]*' | cut -d'"' -f4)
    
    # Create API mapping
    aws apigatewayv2 create-api-mapping \
        --domain-name "$API_DOMAIN" \
        --api-id "$HTTP_API_ID" \
        --stage '$default' > /dev/null
    
    echo -e "${GREEN}HTTP API custom domain created!${NC}"
else
    API_TARGET=$(echo "$EXISTING_API_DOMAIN" | grep -o '"ApiGatewayDomainName": "[^"]*' | cut -d'"' -f4)
    echo -e "${GREEN}HTTP API custom domain already exists${NC}"
fi

# ============================================================================
# Step 4: Create custom domain for WebSocket API
# ============================================================================
echo ""
echo -e "${CYAN}Step 4: Setting up custom domain for WebSocket API...${NC}"

# Extract WebSocket API ID from URL
WS_API_ID=$(echo "$REACT_APP_WS_BASE_URL" | sed 's|wss://||' | cut -d'.' -f1)

# Check if domain already exists
EXISTING_WS_DOMAIN=$(aws apigatewayv2 get-domain-name \
    --domain-name "$WS_DOMAIN" 2>/dev/null || echo "")

if [ -z "$EXISTING_WS_DOMAIN" ]; then
    # Create custom domain
    WS_DOMAIN_CONFIG=$(aws apigatewayv2 create-domain-name \
        --domain-name "$WS_DOMAIN" \
        --domain-name-configurations CertificateArn="$CERT_ARN")
    
    WS_TARGET=$(echo "$WS_DOMAIN_CONFIG" | grep -o '"ApiGatewayDomainName": "[^"]*' | cut -d'"' -f4)
    
    # Create API mapping
    aws apigatewayv2 create-api-mapping \
        --domain-name "$WS_DOMAIN" \
        --api-id "$WS_API_ID" \
        --stage 'prod' > /dev/null
    
    echo -e "${GREEN}WebSocket API custom domain created!${NC}"
else
    WS_TARGET=$(echo "$EXISTING_WS_DOMAIN" | grep -o '"ApiGatewayDomainName": "[^"]*' | cut -d'"' -f4)
    echo -e "${GREEN}WebSocket API custom domain already exists${NC}"
fi

# ============================================================================
# Step 5: Display DNS Records to Add
# ============================================================================
echo ""

# Get the actual target domain names
CF_DOMAIN=$(aws cloudfront get-distribution --id "$DISTRIBUTION_ID" \
    --query 'Distribution.DomainName' --output text)

API_TARGET=$(aws apigatewayv2 get-domain-name --domain-name "$API_DOMAIN" \
    --query 'DomainNameConfigurations[0].ApiGatewayDomainName' --output text 2>/dev/null || echo "")

WS_TARGET=$(aws apigatewayv2 get-domain-name --domain-name "$WS_DOMAIN" \
    --query 'DomainNameConfigurations[0].ApiGatewayDomainName' --output text 2>/dev/null || echo "")

echo -e "${YELLOW}╔═══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║  ADD THESE DNS RECORDS                                                        ║${NC}"
echo -e "${YELLOW}╠═══════════════════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${YELLOW}║${NC}"
echo -e "${YELLOW}║${NC}  ${GREEN}1. Frontend (CloudFront)${NC}"
echo -e "${YELLOW}║${NC}     Type:   CNAME"
echo -e "${YELLOW}║${NC}     Name:   ${FRONTEND_SUBDOMAIN}"
echo -e "${YELLOW}║${NC}     Value:  ${CF_DOMAIN}"
echo -e "${YELLOW}║${NC}"
echo -e "${YELLOW}║${NC}  ${GREEN}2. HTTP API${NC}"
echo -e "${YELLOW}║${NC}     Type:   CNAME"
echo -e "${YELLOW}║${NC}     Name:   ${API_SUBDOMAIN}"
echo -e "${YELLOW}║${NC}     Value:  ${API_TARGET}"
echo -e "${YELLOW}║${NC}"
echo -e "${YELLOW}║${NC}  ${GREEN}3. WebSocket API${NC}"
echo -e "${YELLOW}║${NC}     Type:   CNAME"
echo -e "${YELLOW}║${NC}     Name:   ${WS_SUBDOMAIN}"
echo -e "${YELLOW}║${NC}     Value:  ${WS_TARGET}"
echo -e "${YELLOW}║${NC}"
echo -e "${YELLOW}╚═══════════════════════════════════════════════════════════════════════════════╝${NC}"

# If using Route 53, offer to add records automatically
if [[ "$USE_ROUTE53" =~ ^[Yy]$ ]] && [ -n "$HOSTED_ZONE_ID" ]; then
    echo ""
    echo -e "${CYAN}Add these DNS records to Route 53 automatically? (y/n)${NC}"
    read -r ADD_RECORDS
    
    if [[ "$ADD_RECORDS" =~ ^[Yy]$ ]]; then
        # Add all CNAME records
        aws route53 change-resource-record-sets \
            --hosted-zone-id "$HOSTED_ZONE_ID" \
            --change-batch '{
                "Changes": [
                    {
                        "Action": "UPSERT",
                        "ResourceRecordSet": {
                            "Name": "'"$FRONTEND_DOMAIN"'",
                            "Type": "CNAME",
                            "TTL": 300,
                            "ResourceRecords": [{"Value": "'"$CF_DOMAIN"'"}]
                        }
                    },
                    {
                        "Action": "UPSERT",
                        "ResourceRecordSet": {
                            "Name": "'"$API_DOMAIN"'",
                            "Type": "CNAME",
                            "TTL": 300,
                            "ResourceRecords": [{"Value": "'"$API_TARGET"'"}]
                        }
                    },
                    {
                        "Action": "UPSERT",
                        "ResourceRecordSet": {
                            "Name": "'"$WS_DOMAIN"'",
                            "Type": "CNAME",
                            "TTL": 300,
                            "ResourceRecords": [{"Value": "'"$WS_TARGET"'"}]
                        }
                    }
                ]
            }' > /dev/null
        
        echo -e "${GREEN}DNS records added to Route 53!${NC}"
    fi
fi

# ============================================================================
# Step 6: Rebuild Frontend with Custom Domain URLs
# ============================================================================
echo ""
echo -e "${CYAN}Step 6: Rebuilding frontend with custom domain URLs...${NC}"

cd "$SCRIPT_DIR/frontend"

# Build with new URLs
REACT_APP_API_BASE_URL="https://${API_DOMAIN}" \
REACT_APP_WS_BASE_URL="wss://${WS_DOMAIN}" \
npm run build > /dev/null 2>&1

echo -e "${GREEN}Frontend built with custom domain URLs${NC}"

# Upload to S3
BUCKET_NAME="rook-game-frontend-$(aws sts get-caller-identity --query Account --output text)"
aws s3 sync build/ "s3://${BUCKET_NAME}" --delete > /dev/null

echo -e "${GREEN}Frontend uploaded to S3${NC}"

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --paths "/*" > /dev/null

echo -e "${GREEN}CloudFront cache invalidated${NC}"

# ============================================================================
# Step 7: Update deployment env
# ============================================================================
cat >> "$DEPLOYMENT_ENV" << EOF

# Custom Domain Configuration
CUSTOM_DOMAIN=$DOMAIN
FRONTEND_URL=https://${FRONTEND_DOMAIN}
API_URL=https://${API_DOMAIN}
WS_URL=wss://${WS_DOMAIN}
CERT_ARN=$CERT_ARN
EOF

# ============================================================================
# Done!
# ============================================================================
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                     🎉 CUSTOM DOMAIN SETUP COMPLETE!                          ║${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}                                                                               ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Your Rook game is now available at:                                          ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                                                               ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  🎮 Frontend:   ${CYAN}https://${FRONTEND_DOMAIN}${NC}"
echo -e "${GREEN}║${NC}  🔌 API:        ${CYAN}https://${API_DOMAIN}${NC}"
echo -e "${GREEN}║${NC}  📡 WebSocket:  ${CYAN}wss://${WS_DOMAIN}${NC}"
echo -e "${GREEN}║${NC}                                                                               ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  ⚠️  DNS propagation may take up to 48 hours (usually much faster)            ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  ⚠️  CloudFront update may take 15-20 minutes                                 ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                                                               ${GREEN}║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Cleanup
rm -f /tmp/cf-config.json /tmp/cf-config-updated.json
