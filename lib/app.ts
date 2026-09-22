import { App } from 'aws-cdk-lib';
import { RdsStack } from './rds/rds';
import { S3Stack } from './s3/s3';
import { SqsStack } from './sqs/sqs';
import { EventBridgeStack } from './eventbridge/eventbridge';
import { EcrStack } from './ecr/ecr';
import { EcsStack } from './ecs/ecs';
import { WafStack } from './waf/waf';
import { EodLambdaStack } from './lambda/eodLambda';
import { IntradayLambdaStack } from './lambda/intradayLambda';
import { StockResearchLambdaStack } from './lambda/stockResearchLambda';

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const s3 = new S3Stack(app, 'S3Stack', { env });
const sqs = new SqsStack(app, 'SqsStack', { env });
const ecr = new EcrStack(app, 'EcrStack', { env });
const rds = new RdsStack(app, 'RdsStack', { env });

// The queue and scheduler stacks stay constructed, unreferenced, for one deploy:
// the ECS stack must drop its imports of them before they can be destroyed.
new EventBridgeStack(app, 'EventBridgeStack', {
  env,
  cronJobQueue: sqs.cronJobQueue,
});

const ecs = new EcsStack(app, 'EcsStack', {
  env,
  repository: ecr.repository,
  database: rds.instance,
  databaseCredentials: rds.credentials,
  databaseSecurityGroup: rds.securityGroup,
  strategiesBucket: s3.strategiesBucket,
  uploadsBucket: s3.uploadsBucket,
  workerQueue: sqs.workerQueue,
});

new EodLambdaStack(app, 'EodLambdaStack', {
  env,
  internalApiUrl: ecs.apiUrl,
});

new IntradayLambdaStack(app, 'IntradayLambdaStack', {
  env,
  internalApiUrl: ecs.apiUrl,
});

new StockResearchLambdaStack(app, 'StockResearchLambdaStack', {
  env,
  internalApiUrl: ecs.apiUrl,
});

new WafStack(app, 'WafStack', {
  env,
  loadBalancerArn: ecs.loadBalancerArn,
});
