import { Stack, StackProps, Duration, TimeZone } from 'aws-cdk-lib';
import { Vpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
import {
  Cluster,
  ContainerImage,
  FargateTaskDefinition,
  Secret as EcsSecret,
  LogDrivers,
} from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { ApplicationProtocol } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Schedule, ScheduleExpression } from 'aws-cdk-lib/aws-scheduler';
import { EcsRunFargateTask } from 'aws-cdk-lib/aws-scheduler-targets';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Role, ServicePrincipal, ManagedPolicy, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

const ZONE_NAME = 'tradehoudini.com';
const API_DOMAIN = `api.${ZONE_NAME}`;

const AUTH0_DOMAIN = 'houdini-prod.us.auth0.com';
const AUTH0_AUDIENCE = 'https://api.tradehoudini.com';

// Loopback is the only redirect Robinhood's shared public client whitelists, and
// nothing serves it: the user copies the dead address back into /connect. Once a
// client of our own is provisioned this becomes an address we actually host.
const ROBINHOOD_REDIRECT_URI = 'http://localhost:8080/callback';

const APNS_BUNDLE_ID = 'com.tradehoudini.houdini';

// Sandbox while the app is installed from Xcode; TestFlight and App Store
// builds mint production tokens instead, and the two hosts reject each other's.
const APNS_ENV = 'sandbox';

interface EcsStackProps extends StackProps {
  repository: Repository;
  cronJobQueue: Queue;
  schedulerRoleArn: string;
  strategiesBucket: Bucket;
  uploadsBucket: Bucket;
  usersTable: Table;
  identitiesTable: Table;
  portfoliosTable: Table;
  positionsTable: Table;
  tradesTable: Table;
  cronJobsTable: Table;
  cronJobRunsTable: Table;
  portfolioEodValueHistoryTable: Table;
  overviewEodValueHistoryTable: Table;
  portfolioIntradayValueHistoryTable: Table;
  overviewIntradayValueHistoryTable: Table;
  stockResearchTable: Table;
  briefingsTable: Table;
  brokerConnectionsTable: Table;
  deviceTokensTable: Table;
}

export class EcsStack extends Stack {
  // Callers must start on HTTPS rather than rely on the port 80 redirect: a 301
  // downgrades a POST to GET, and the internal triggers are POSTs.
  public readonly apiUrl: string;
  // Consumed by the WAF stack, which associates a Web ACL to this ALB.
  public readonly loadBalancerArn: string;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    // ── Secrets ───────────────────────────────────────────────────────────────
    const massiveSecret = Secret.fromSecretNameV2(this, 'MassiveSecret', 'houdini/massive');
    const alpacaSecret = Secret.fromSecretNameV2(this, 'AlpacaSecret', 'houdini/alpaca');
    const fmpSecret = Secret.fromSecretNameV2(this, 'FmpSecret', 'houdini/fmp');
    const anthropicSecret = Secret.fromSecretNameV2(this, 'AnthropicSecret', 'houdini/anthropic');
    const apnsSecret = Secret.fromSecretNameV2(this, 'ApnsSecret', 'houdini/apns');

    // ── IAM ───────────────────────────────────────────────────────────────────
    const taskRole = new Role(this, 'TaskRole', {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    const tables = [
      props.usersTable,
      props.identitiesTable,
      props.portfoliosTable,
      props.positionsTable,
      props.tradesTable,
      props.cronJobsTable,
      props.cronJobRunsTable,
      props.portfolioEodValueHistoryTable,
      props.overviewEodValueHistoryTable,
      props.portfolioIntradayValueHistoryTable,
      props.overviewIntradayValueHistoryTable,
      props.stockResearchTable,
      props.briefingsTable,
      props.brokerConnectionsTable,
      props.deviceTokensTable,
    ];
    tables.forEach((t) => t.grantReadWriteData(taskRole));
    props.strategiesBucket.grantReadWrite(taskRole);
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

    // createCronJobForPortfolio creates EventBridge schedules, scoped to the
    // houdini-cron-jobs group so the task can't touch schedules elsewhere in the
    // account. The group name must match the CfnScheduleGroup in eventbridge.ts.
    taskRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'scheduler:CreateSchedule',
          'scheduler:UpdateSchedule',
          'scheduler:GetSchedule',
          'scheduler:DeleteSchedule',
        ],
        resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/houdini-cron-jobs/*`],
      }),
    );
    taskRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [props.schedulerRoleArn],
      }),
    );

    // The app consumes the cron job queue directly (receive/delete), and
    // enqueues a portfolio's first run at launch.
    props.cronJobQueue.grantConsumeMessages(taskRole);
    props.cronJobQueue.grantSendMessages(taskRole);

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

    // Container env + secrets shared by the always-on service and the scheduled
    // job tasks below. They must match: config.ts validates the full set at
    // import, so any job entrypoint that loads a service also loads this config.
    const containerEnvironment = {
      AWS_REGION: this.region,
      STRATEGIES_BUCKET: props.strategiesBucket.bucketName,
      UPLOADS_BUCKET: props.uploadsBucket.bucketName,
      CRON_JOB_QUEUE_ARN: props.cronJobQueue.queueArn,
      SCHEDULER_ROLE_ARN: props.schedulerRoleArn,
      AUTH0_DOMAIN,
      AUTH0_AUDIENCE,
      ROBINHOOD_REDIRECT_URI,
      APNS_BUNDLE_ID,
      // Tokens minted by an Xcode build only answer to Apple's sandbox host;
      // TestFlight and App Store builds mint production ones. Same key signs
      // for both, so the switch is this line and a redeploy.
      APNS_ENV,
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
    };

    // ── ECS + ALB ─────────────────────────────────────────────────────────────
    const vpc = Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });
    const cluster = new Cluster(this, 'HoudiniCluster', { vpc, clusterName: 'HoudiniCluster' });

    const logGroup = new LogGroup(this, 'HoudiniLogGroup', {
      logGroupName: '/ecs/houdini',
      retention: RetentionDays.ONE_MONTH,
    });

    // The zone is registrar-created, not stack-owned, so it is looked up rather
    // than declared. The pattern issues and DNS-validates the certificate itself.
    const hostedZone = HostedZone.fromLookup(this, 'HoudiniZone', { domainName: ZONE_NAME });

    const service = new ApplicationLoadBalancedFargateService(this, 'HoudiniService', {
      cluster,
      domainName: API_DOMAIN,
      domainZone: hostedZone,
      protocol: ApplicationProtocol.HTTPS,
      redirectHTTP: true,
      memoryLimitMiB: 1024,
      cpu: 512,
      desiredCount: 1,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      assignPublicIp: true,
      taskSubnets: { subnetType: SubnetType.PUBLIC },
      loadBalancerName: 'HoudiniALB',
      serviceName: 'HoudiniService',
      taskImageOptions: {
        image: ContainerImage.fromEcrRepository(props.repository, 'latest'),
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

    const scaling = service.service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 4,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60,
      scaleInCooldown: Duration.seconds(120),
      scaleOutCooldown: Duration.seconds(60),
    });

    service.targetGroup.configureHealthCheck({
      path: '/',
      interval: Duration.seconds(30),
    });

    // ── Scheduled jobs ────────────────────────────────────────────────────────
    // EOD, intraday, and stock-research run as scheduled Fargate tasks
    // (EventBridge Scheduler -> ECS RunTask), not public /internal HTTP routes.
    // Each reuses the service image, task role, execution role, and the exact
    // same env + secrets, differing only by the command it runs. Timezone-aware
    // cron matches the legacy Lambda schedules so DST never shifts them.
    //
    // These are the live triggers for EOD/intraday/stock-research. The legacy
    // Lambda triggers (lib/lambda/*) are disabled and pending removal once a
    // real scheduled fire is confirmed.
    const NY = TimeZone.AMERICA_NEW_YORK;
    const jobs = [
      {
        id: 'Eod',
        scheduleName: 'houdini-eod-task',
        command: ['node', 'dist/jobs/eod.js'],
        // 4:30 PM ET weekdays — 30 min after close
        schedule: ScheduleExpression.cron({ minute: '30', hour: '16', weekDay: 'MON-FRI', timeZone: NY }),
      },
      {
        id: 'Intraday',
        scheduleName: 'houdini-intraday-task',
        command: ['node', 'dist/jobs/intraday.js'],
        schedule: ScheduleExpression.cron({ minute: '0/5', hour: '4-20', weekDay: 'MON-FRI', timeZone: NY }),
        maxEventAge: Duration.minutes(4),
      },
      {
        id: 'StockResearch',
        scheduleName: 'houdini-stock-research-task',
        command: ['node', 'dist/jobs/stockResearch.js'],
        // 8:00 AM ET weekdays — pre-market cache warm
        schedule: ScheduleExpression.cron({ minute: '0', hour: '8', weekDay: 'MON-FRI', timeZone: NY }),
      },
    ];

    for (const job of jobs) {
      const taskDefinition = new FargateTaskDefinition(this, `${job.id}JobTaskDef`, {
        family: job.scheduleName.replace(/-task$/, '-job'),
        cpu: 512,
        memoryLimitMiB: 1024,
        taskRole,
        executionRole,
      });

      taskDefinition.addContainer(`${job.id}JobContainer`, {
        image: ContainerImage.fromEcrRepository(props.repository, 'latest'),
        command: job.command,
        environment: containerEnvironment,
        secrets: containerSecrets,
        logging: LogDrivers.awsLogs({ logGroup, streamPrefix: 'jobs' }),
      });

      new Schedule(this, `${job.id}JobSchedule`, {
        scheduleName: job.scheduleName,
        schedule: job.schedule,
        enabled: true,
        target: new EcsRunFargateTask(cluster, {
          taskDefinition,
          // Default VPC has no private subnets; matches how the service runs
          // today (revisit under the private-VPC backlog item).
          vpcSubnets: { subnetType: SubnetType.PUBLIC },
          assignPublicIp: true,
          retryAttempts: 2,
          ...(job.maxEventAge ? { maxEventAge: job.maxEventAge } : {}),
        }),
      });
    }

    this.apiUrl = `https://${API_DOMAIN}`;
    this.loadBalancerArn = service.loadBalancer.loadBalancerArn;
  }
}
