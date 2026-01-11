# AWS Deployment Guide

This guide explains how to deploy the Rook game to AWS.

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **AWS CLI** installed and configured (`aws configure`)
3. **SAM CLI** installed ([Installation Guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html))
4. **Node.js 18+** installed
5. **Root/IAM user** with permissions to create:
   - Lambda functions
   - API Gateway (HTTP and WebSocket)
   - DynamoDB tables
   - S3 buckets
   - CloudFront distributions
   - IAM roles and policies

## Quick Start

Deploy everything with one command:

```bash
./deploy.sh
```

This will:
1. Deploy the backend (Lambda + API Gateway + DynamoDB)
2. Deploy the frontend (S3 + CloudFront)
3. Output all URLs

## Step-by-Step Deployment

### 1. Deploy Backend

```bash
./deploy-backend.sh
```

This will:
- Build the SAM application
- Deploy to AWS (first time will prompt for configuration)
- Create DynamoDB tables
- Create Lambda functions
- Create API Gateway (HTTP + WebSocket)
- Output API URLs

**First deployment:** You'll be prompted for:
- Stack name (default: `rook-game`)
- AWS Region (default: `us-east-1`)
- Confirm changes before deploy
- Allow SAM CLI IAM role creation
- Save arguments to configuration file

**Subsequent deployments:** Just run `./deploy-backend.sh` again.

### 2. Deploy Frontend

```bash
./deploy-frontend.sh
```

This will:
- Build the React app with production API URLs
- Create S3 bucket (if needed)
- Upload build files
- Create/update CloudFront distribution
- Output frontend URL

**Note:** CloudFront distribution creation takes 15-20 minutes on first deploy.

## Manual Deployment

### Backend Only

```bash
cd backend
npm install
sam build
sam deploy --guided  # First time
sam deploy            # Subsequent deployments
```

### Frontend Only

```bash
cd frontend
npm install

# Set environment variables from backend deployment
export REACT_APP_API_BASE_URL=<your-http-api-url>
export REACT_APP_WS_BASE_URL=<your-websocket-api-url>

npm run build

# Deploy to S3
aws s3 sync build/ s3://<bucket-name> --delete

# Invalidate CloudFront
aws cloudfront create-invalidation --distribution-id <id> --paths "/*"
```

## Deployment URLs

After deployment, URLs are saved to `.deployment-env`:

- `REACT_APP_API_BASE_URL` - HTTP API Gateway URL
- `REACT_APP_WS_BASE_URL` - WebSocket API Gateway URL
- `DISTRIBUTION_ID` - CloudFront distribution ID

## Architecture

### Backend
- **DynamoDB Tables:**
  - `RookGames` - Game state
  - `RookHands` - Player hands
  - `RookConnections` - WebSocket connections

- **Lambda Functions:**
  - `CreateGameFunction` - HTTP POST /createGame
  - `JoinGameFunction` - HTTP POST /joinGame
  - `ChoosePartnerFunction` - HTTP POST /choosePartner
  - `ConnectFunction` - WebSocket $connect
  - `DisconnectFunction` - WebSocket $disconnect
  - `WebSocketRouterFunction` - WebSocket $default (routes messages)

- **API Gateway:**
  - HTTP API with CORS enabled
  - WebSocket API for real-time communication

### Frontend
- **S3 Bucket** - Static website hosting
- **CloudFront** - CDN distribution with SPA routing support

## Troubleshooting

### SAM Build Fails
- Ensure Node.js 18+ is installed
- Run `npm install` in backend directory
- Check that all handler files exist

### Deployment Fails
- Check AWS credentials: `aws sts get-caller-identity`
- Verify IAM permissions
- Check CloudFormation stack events in AWS Console

### Frontend Can't Connect to Backend
- Verify API URLs in `.deployment-env`
- Check CORS configuration in API Gateway
- Ensure frontend was built with correct environment variables

### WebSocket Not Working
- Check WebSocket API is deployed
- Verify connection URL format: `wss://<api-id>.execute-api.<region>.amazonaws.com/prod`
- Check Lambda function logs for errors

## Cost Estimation

For low-medium traffic:
- **DynamoDB**: Free tier (25GB storage, 25 RCU/WCU)
- **Lambda**: Free tier (1M requests/month)
- **API Gateway**: ~$1 per million HTTP requests, ~$0.25 per million WebSocket connection-minutes
- **S3**: ~$0.023 per GB storage
- **CloudFront**: First 1TB free, then $0.085 per GB

**Estimated monthly cost: $0-5** (within free tiers for low traffic)

## Cleanup

To remove all AWS resources:

```bash
cd backend
sam delete --stack-name rook-game

# Delete S3 bucket
aws s3 rb s3://<bucket-name> --force

# Delete CloudFront distribution (disable first, then delete after 15+ minutes)
aws cloudfront get-distribution --id <distribution-id>
aws cloudfront delete-distribution --id <distribution-id> --if-match <etag>
```

## Notes

- The deployment creates AWS-provided URLs (no custom domain needed)
- First CloudFront deployment takes 15-20 minutes
- Subsequent deployments are faster (~2-3 minutes)
- All environment variables are automatically configured
