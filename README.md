# houdini-cdk

AWS CDK infrastructure for Houdini — an AI-driven stock trading simulation platform.

## Stacks

| Stack | Resources |
|---|---|
| `DdbStack` | 7 DynamoDB tables: users, portfolios, positions, trades, cronJobs, cronJobRuns, transactions |
| `S3Stack` | Strategies bucket (versioned) — stores per-user strategy documents |
| `SqsStack` | Cron job queue + DLQ (3 retries before dead-letter) |
| `EventBridgeStack` | Scheduler group + IAM role for firing schedules into SQS |
| `CronLambdaStack` | Cron execution Lambda — triggered by SQS, reads config from DynamoDB, executes trades via Claude |

## Best practices

- **No wildcard imports** — ESLint enforces named imports only (`import/no-namespace`). The build will fail if a wildcard import is introduced.
- **One folder per resource type** — each AWS service gets its own folder under `lib/`. Types and constants live in the same folder as the stack that owns them.
- **One stack per resource type by default** — keeps stacks focused and blast radius small. Split into multiple stacks when use cases are sufficiently different (e.g. a Lambda for cron execution vs a Lambda for API handling belong in separate stacks).

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
