import { Stack, StackProps, Duration, TimeZone } from 'aws-cdk-lib';
import { Vpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
import {
  Cluster,
  ContainerImage,
  FargateService,
  FargateTaskDefinition,
  Secret as EcsSecret,
  LogDrivers,
} from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { ApplicationProtocol } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Schedule } from 'aws-cdk-lib/aws-applicationautoscaling';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Role, ServicePrincipal, ManagedPolicy, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
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
  strategiesBucket: Bucket;
  uploadsBucket: Bucket;
  usersTable: Table;
  identitiesTable: Table;
  portfoliosTable: Table;
  positionsTable: Table;
  tradesTable: Table;
  cronJobsTable: Table;
  cronJobRunsTable: Table;
  agentsTable: Table;
  activityTable: Table;
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
  // downgrades a POST to GET.
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
      props.agentsTable,
      props.activityTable,
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

    const image = ContainerImage.fromEcrRepository(props.repository, 'latest');

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

    // ── Worker ────────────────────────────────────────────────────────────────
    // The worker owns time: agents' wakes, the intraday valuation, and the
    // end-of-day pass all run on its minute clock. Same image, same role, same
    // env; only the command differs. It answers no requests, so it sits behind
    // no load balancer, and it runs on market days from before the open to
    // after the end-of-day pass, scaling to nothing overnight and at weekends.
    const workerTaskDefinition = new FargateTaskDefinition(this, 'WorkerTaskDef', {
      family: 'houdini-worker',
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

    const worker = new FargateService(this, 'HoudiniWorker', {
      cluster,
      serviceName: 'HoudiniWorker',
      taskDefinition: workerTaskDefinition,
      desiredCount: 1,
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      assignPublicIp: true,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
    });

    const workerScaling = worker.autoScaleTaskCount({ minCapacity: 0, maxCapacity: 1 });
    const NY = TimeZone.AMERICA_NEW_YORK;
    workerScaling.scaleOnSchedule('MarketOpen', {
      schedule: Schedule.cron({ minute: '45', hour: '6', weekDay: 'MON-FRI' }),
      timeZone: NY,
      minCapacity: 1,
      maxCapacity: 1,
    });
    workerScaling.scaleOnSchedule('MarketClosed', {
      schedule: Schedule.cron({ minute: '15', hour: '17', weekDay: 'MON-FRI' }),
      timeZone: NY,
      minCapacity: 0,
      maxCapacity: 0,
    });

    this.apiUrl = `https://${API_DOMAIN}`;
    this.loadBalancerArn = service.loadBalancer.loadBalancerArn;
  }
}
