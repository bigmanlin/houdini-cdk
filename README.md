# houdini-cdk

AWS CDK infrastructure for Houdini — an AI-driven stock trading simulation platform.

## Stacks

| Stack | Resources |
|---|---|
| `DdbStack` | DynamoDB tables for all persistent state |
| `S3Stack` | Strategy documents and temporary chat-attachment uploads |
| `SqsStack` | Cron job queue and dead-letter queue, consumed in-process by the ECS app |
| `EventBridgeStack` | Scheduler group and IAM role for firing per-job schedules into SQS |
| `EcrStack` | Container repository for the backend image |
| `EcsStack` | Fargate service behind an ALB, running the API and the cron queue consumer |
| `EodLambdaStack` | Daily end-of-day snapshot trigger — a thin HTTP proxy to the ECS API |
| `IntradayLambdaStack` | Intraday snapshot trigger — a thin HTTP proxy to the ECS API |
| `StockResearchLambdaStack` | Daily research ingestion trigger — a thin HTTP proxy to the ECS API |

Conventions and the rules that protect deployed data are in [CLAUDE.md](CLAUDE.md).
Read those before changing a table.

## Prerequisites

- Node.js 20+
- AWS CLI configured (`aws configure`)
- AWS CDK CLI (`npm install -g aws-cdk`)

## Setup

```bash
npm install
```

## Commands

```bash
npm run build       # lint → compile → test → synth
npm test            # run CDK unit tests
npm run synth       # synthesize CloudFormation templates
npm run diff        # preview changes against deployed stacks
npm run deploy      # deploy all stacks
```

## First-time deploy

Bootstrap CDK in your AWS account (one-time per account/region):

```bash
npx cdk bootstrap
npx cdk deploy --all
```

## Region

Deployed to `us-west-2` by default. Set `CDK_DEFAULT_REGION` to override.
