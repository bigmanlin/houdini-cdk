import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import {
  Vpc,
  SubnetType,
  SecurityGroup,
  CfnSecurityGroupIngress,
} from 'aws-cdk-lib/aws-ec2';
import {
  Cluster,
  ContainerImage,
  FargateService,
  FargateTaskDefinition,
  Secret as EcsSecret,
  LogDrivers,
} from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import {
  ApplicationProtocol,
  HttpCodeTarget,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import {
  Alarm,
  ComparisonOperator,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Role, ServicePrincipal, ManagedPolicy, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { DatabaseInstance } from 'aws-cdk-lib/aws-rds';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import {
  FilterPattern,
  LogGroup,
  MetricFilter,
  RetentionDays,
} from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

// The API's DNS lives at Cloudflare, not Route 53, so the certificate is issued
// outside the stack and referenced by ARN; nothing here writes a DNS record.
const API_DOMAIN = 'api.atrius.app';
const API_CERTIFICATE_ARN =
  'arn:aws:acm:us-west-2:339640512039:certificate/3541e017-9701-4367-b417-ca649191cbc3';

const AUTH0_DOMAIN = 'auth.atrius.app';
const AUTH0_AUDIENCE = 'https://api.atrius.app';

// Loopback is the only redirect Robinhood's shared public client whitelists, and
// nothing serves it: the user copies the dead address back into /connect. Once a
// client of our own is provisioned this becomes an address we actually host.
const ROBINHOOD_REDIRECT_URI = 'http://localhost:8080/callback';

const APNS_BUNDLE_ID = 'app.atrius';

// Sandbox while the app is installed from Xcode; TestFlight and App Store
// builds mint production tokens instead, and the two hosts reject each other's.
const APNS_ENV = 'sandbox';

interface EcsStackProps extends StackProps {
  repository: Repository;
  strategiesBucket: Bucket;
  uploadsBucket: Bucket;
  usersTable: Table;
  identitiesTable: Table;
  portfoliosTable: Table;
  positionsTable: Table;
  bookPositionsTable: Table;
  agentsTable: Table;
  activityTable: Table;
  portfolioEodValueHistoryTable: Table;
  overviewEodValueHistoryTable: Table;
  portfolioIntradayValueHistoryTable: Table;
  overviewIntradayValueHistoryTable: Table;
  brokerConnectionsTable: Table;
  deviceTokensTable: Table;
  workerQueue: Queue;
  database: DatabaseInstance;
  databaseCredentials: Secret;
  databaseSecurityGroup: SecurityGroup;
}

export class EcsStack extends Stack {
  // Callers must start on HTTPS rather than rely on the port 80 redirect: a 301
  // downgrades a POST to GET.
  public readonly apiUrl: string;
  // Consumed by the WAF stack, which associates a Web ACL to this ALB.
  public readonly loadBalancerArn: string;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    // ── Secrets ───────────────────────────────────────────────────────────────
    const massiveSecret = Secret.fromSecretNameV2(this, 'MassiveSecret', 'atrius/massive');
    const alpacaSecret = Secret.fromSecretNameV2(this, 'AlpacaSecret', 'atrius/alpaca');
    const fmpSecret = Secret.fromSecretNameV2(this, 'FmpSecret', 'atrius/fmp');
    const anthropicSecret = Secret.fromSecretNameV2(this, 'AnthropicSecret', 'atrius/anthropic');
    const apnsSecret = Secret.fromSecretNameV2(this, 'ApnsSecret', 'atrius/apns');

    // ── IAM ───────────────────────────────────────────────────────────────────
    const taskRole = new Role(this, 'TaskRole', {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    const tables = [
      props.usersTable,
      props.identitiesTable,
      props.portfoliosTable,
      props.positionsTable,
      props.bookPositionsTable,
      props.agentsTable,
      props.activityTable,
      props.portfolioEodValueHistoryTable,
      props.overviewEodValueHistoryTable,
      props.portfolioIntradayValueHistoryTable,
      props.overviewIntradayValueHistoryTable,
      props.brokerConnectionsTable,
      props.deviceTokensTable,
    ];
    tables.forEach((t) => t.grantReadWriteData(taskRole));
    props.strategiesBucket.grantReadWrite(taskRole);
    // One role for both tasks: the API sends the nudge, the worker receives it.
    props.workerQueue.grantSendMessages(taskRole);
    props.workerQueue.grantConsumeMessages(taskRole);
    // Chat attachments: the app only presigns PUT/GET against the temp prefix, so
    // grant exactly those two actions (least privilege, and keeps the role's
    // policy small enough to avoid being split into an overflow managed policy).
    taskRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['s3:PutObject', 's3:GetObject'],
        resources: [props.uploadsBucket.arnForObjects('tmp/*')],
      }),
    );

    // Execution role — ECS agent uses this to pull the image and fetch secrets
    const executionRole = new Role(this, 'ExecutionRole', {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    massiveSecret.grantRead(executionRole);
    alpacaSecret.grantRead(executionRole);
    fmpSecret.grantRead(executionRole);
    anthropicSecret.grantRead(executionRole);

    // Container env + secrets shared by the API and the worker. They must match:
    // config.ts validates the full set at import, and both entry points load it.
    const containerEnvironment = {
      AWS_REGION: this.region,
      STRATEGIES_BUCKET: props.strategiesBucket.bucketName,
      UPLOADS_BUCKET: props.uploadsBucket.bucketName,
      WORKER_QUEUE_URL: props.workerQueue.queueUrl,
      AUTH0_DOMAIN,
      AUTH0_AUDIENCE,
      ROBINHOOD_REDIRECT_URI,
      APNS_BUNDLE_ID,
      // Tokens minted by an Xcode build only answer to Apple's sandbox host;
      // TestFlight and App Store builds mint production ones. Same key signs
      // for both, so the switch is this line and a redeploy.
      APNS_ENV,
      DATABASE_HOST: props.database.dbInstanceEndpointAddress,
      DATABASE_PORT: props.database.dbInstanceEndpointPort,
      DATABASE_NAME: 'atrius',
    };

    const containerSecrets = {
      MASSIVE_API_KEY: EcsSecret.fromSecretsManager(massiveSecret, 'apiKey'),
      ALPACA_API_KEY: EcsSecret.fromSecretsManager(alpacaSecret, 'apiKey'),
      ALPACA_API_SECRET: EcsSecret.fromSecretsManager(alpacaSecret, 'apiSecret'),
      FMP_API_KEY: EcsSecret.fromSecretsManager(fmpSecret, 'apiKey'),
      ANTHROPIC_API_KEY: EcsSecret.fromSecretsManager(anthropicSecret, 'apiKey'),
      APNS_KEY: EcsSecret.fromSecretsManager(apnsSecret, 'key'),
      APNS_KEY_ID: EcsSecret.fromSecretsManager(apnsSecret, 'keyId'),
      APNS_TEAM_ID: EcsSecret.fromSecretsManager(apnsSecret, 'teamId'),
      // Never an environment variable: a connection string assembled in
      // infrastructure would print the password into the task definition.
      DATABASE_USER: EcsSecret.fromSecretsManager(props.databaseCredentials, 'username'),
      DATABASE_PASSWORD: EcsSecret.fromSecretsManager(props.databaseCredentials, 'password'),
    };

    // ── ECS + ALB ─────────────────────────────────────────────────────────────
    const vpc = Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });
    const cluster = new Cluster(this, 'AtriusCluster', { vpc, clusterName: 'AtriusCluster' });

    const logGroup = new LogGroup(this, 'AtriusLogGroup', {
      logGroupName: '/ecs/atrius',
      retention: RetentionDays.ONE_MONTH,
    });

    const image = ContainerImage.fromEcrRepository(props.repository, 'latest');

    const service = new ApplicationLoadBalancedFargateService(this, 'AtriusService', {
      cluster,
      certificate: Certificate.fromCertificateArn(this, 'ApiCertificate', API_CERTIFICATE_ARN),
      protocol: ApplicationProtocol.HTTPS,
      redirectHTTP: true,
      memoryLimitMiB: 1024,
      cpu: 512,
      // Two, so losing one is a slower minute rather than an outage. One task
      // meant any crash took the API down until a replacement passed its
      // health checks, with nothing serving in between.
      desiredCount: 2,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      // A deployment that cannot serve is rolled back rather than left in
      // place. Without this a task that fails every request stays live as long
      // as it answers the health check.
      circuitBreaker: { rollback: true },
      assignPublicIp: true,
      taskSubnets: { subnetType: SubnetType.PUBLIC },
      loadBalancerName: 'AtriusALB',
      serviceName: 'AtriusService',
      taskImageOptions: {
        image,
        containerPort: 3000,
        taskRole,
        executionRole,
        environment: containerEnvironment,
        secrets: containerSecrets,
        logDriver: LogDrivers.awsLogs({
          logGroup,
          streamPrefix: 'ecs',
        }),
      },
      publicLoadBalancer: true,
    });

    // Written as a resource of this stack rather than by asking the security
    // group to add it. That method attaches the rule to whichever stack owns
    // the group, which would make the database stack depend on this one while
    // this one already depends on it for the endpoint.
    //
    // By security group rather than by address, so a task replacing another
    // inherits the permission instead of needing a new rule.
    new CfnSecurityGroupIngress(this, 'ApiToDatabase', {
      groupId: props.databaseSecurityGroup.securityGroupId,
      sourceSecurityGroupId:
        service.service.connections.securityGroups[0].securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 5432,
      toPort: 5432,
      description: 'Atrius API',
    });

    const scaling = service.service.autoScaleTaskCount({
      minCapacity: 2,
      maxCapacity: 4,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60,
      scaleInCooldown: Duration.seconds(120),
      scaleOutCooldown: Duration.seconds(60),
    });

    // Two passes at fifteen seconds rather than five at thirty: a replacement
    // starts taking traffic in half a minute instead of two and a half.
    service.targetGroup.configureHealthCheck({
      path: '/',
      interval: Duration.seconds(15),
      healthyThresholdCount: 2,
    });

    // ── Worker ────────────────────────────────────────────────────────────────
    // The worker owns time: agents' wakes, the intraday valuation, the end of
    // day pass, and strategy builds all run on its minute clock. Same image,
    // same role, same env; only the command differs. It answers no requests,
    // so it sits behind no load balancer. It runs around the clock because an
    // owner deploys at any hour and the build must land before the next open.
    const workerTaskDefinition = new FargateTaskDefinition(this, 'WorkerTaskDef', {
      family: 'atrius-worker',
      cpu: 1024,
      memoryLimitMiB: 2048,
      taskRole,
      executionRole,
    });

    workerTaskDefinition.addContainer('WorkerContainer', {
      image,
      command: ['node', 'dist/worker.js'],
      environment: containerEnvironment,
      secrets: containerSecrets,
      logging: LogDrivers.awsLogs({ logGroup, streamPrefix: 'worker' }),
    });

    // One task, never two: a second worker would wake every agent twice.
    const worker = new FargateService(this, 'AtriusWorker', {
      cluster,
      serviceName: 'AtriusWorker',
      taskDefinition: workerTaskDefinition,
      desiredCount: 1,
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      assignPublicIp: true,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
    });

    new CfnSecurityGroupIngress(this, 'WorkerToDatabase', {
      groupId: props.databaseSecurityGroup.securityGroupId,
      sourceSecurityGroupId: worker.connections.securityGroups[0].securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 5432,
      toPort: 5432,
      description: 'Atrius worker',
    });

    // ── Alarms ────────────────────────────────────────────────────────────────
    // Nothing here changes what the service does. It is the difference between
    // finding out from CloudWatch and finding out by opening the app, which is
    // how every outage so far has been discovered.
    //
    // Subscriptions are added to the topic by hand, so an address is not
    // written into the repository.
    const alarms = new Topic(this, 'AtriusAlarms', {
      topicName: 'atrius-alarms',
      displayName: 'Atrius production',
    });

    const notify = (alarm: Alarm) => alarm.addAlarmAction(new SnsAction(alarms));

    notify(
      new Alarm(this, 'ApiErrors', {
        alarmName: 'atrius-api-5xx',
        alarmDescription: 'The API answered a request with a server error.',
        metric: service.targetGroup.metrics.httpCodeTarget(
          HttpCodeTarget.TARGET_5XX_COUNT,
          { period: Duration.minutes(5), statistic: 'Sum' },
        ),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }),
    );

    notify(
      new Alarm(this, 'ApiUnhealthy', {
        alarmName: 'atrius-api-unhealthy',
        alarmDescription: 'A task stopped answering the load balancer.',
        metric: service.targetGroup.metrics.unhealthyHostCount({
          period: Duration.minutes(1),
          statistic: 'Maximum',
        }),
        threshold: 1,
        evaluationPeriods: 2,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }),
    );

    // The one that would have caught the chart bug in minutes: the app logs one
    // JSON object per line, so its own error level is a metric.
    const errorLines = new MetricFilter(this, 'ErrorLines', {
      logGroup,
      metricNamespace: 'Atrius',
      metricName: 'ErrorLines',
      filterPattern: FilterPattern.stringValue('$.level', '=', 'error'),
      metricValue: '1',
    });

    notify(
      new Alarm(this, 'LoggedErrors', {
        alarmName: 'atrius-logged-errors',
        alarmDescription: 'The application logged errors.',
        metric: errorLines.metric({
          period: Duration.minutes(5),
          statistic: 'Sum',
        }),
        threshold: 5,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }),
    );

    this.apiUrl = `https://${API_DOMAIN}`;
    this.loadBalancerArn = service.loadBalancer.loadBalancerArn;
  }
}
