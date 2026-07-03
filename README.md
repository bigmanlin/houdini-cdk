# houdini-cdk

AWS CDK infrastructure for Houdini — an AI-driven stock trading simulation platform.

## Stacks

| Stack | Resources |
|---|---|
| `DdbStack` | 11 DynamoDB tables: users, portfolios, positions, trades, cronJobs, cronJobRuns, transactions, and per-portfolio/overview EOD + intraday value history |
| `S3Stack` | Strategies bucket (versioned, per-user strategy documents) + temp uploads bucket (chat attachments) |
| `SqsStack` | Cron job queue + DLQ (3 receives before dead-letter). Consumed directly by the ECS app, which runs cron jobs in-process |
| `EventBridgeStack` | Scheduler group + IAM role for firing per-job schedules into SQS |
| `EcrStack` | Container repository for the backend image |
| `EcsStack` | Fargate service behind an ALB (CPU autoscaling, 1–4 tasks) running the API and the cron queue consumer |
| `EodLambdaStack` | Daily end-of-day snapshot trigger — thin HTTP proxy to the ECS API |
| `IntradayLambdaStack` | 30-min intraday snapshot trigger — thin HTTP proxy to the ECS API |

## Best practices

- **No wildcard imports** — ESLint enforces named imports only (`import/no-namespace`). The build will fail if a wildcard import is introduced.
- **One folder per resource type** — each AWS service gets its own folder under `lib/`. Types and constants live in the same folder as the stack that owns them.
- **One stack per resource type by default** — keeps stacks focused and blast radius small. Split into multiple stacks when use cases are sufficiently different (e.g. the EOD and intraday snapshot Lambdas belong in separate stacks).

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
