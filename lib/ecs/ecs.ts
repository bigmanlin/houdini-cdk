import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Vpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Cluster, ContainerImage, Secret as EcsSecret, LogDrivers } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Role, ServicePrincipal, ManagedPolicy, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

interface EcsStackProps extends StackProps {
  repository: Repository;
  cronJobQueue: Queue;
  schedulerRoleArn: string;
  strategiesBucket: Bucket;
  uploadsBucket: Bucket;
  usersTable: Table;
  portfoliosTable: Table;
  positionsTable: Table;
  tradesTable: Table;
  cronJobsTable: Table;
  cronJobRunsTable: Table;
  transactionsTable: Table;
  portfolioEodValueHistoryTable: Table;
  overviewEodValueHistoryTable: Table;
  portfolioIntradayValueHistoryTable: Table;
  overviewIntradayValueHistoryTable: Table;
  stockResearchTable: Table;
  briefingsTable: Table;
}

export class EcsStack extends Stack {
  public readonly loadBalancerDnsName: string;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    // ── Secrets ───────────────────────────────────────────────────────────────
    const alpacaSecret = Secret.fromSecretNameV2(this, 'AlpacaSecret', 'houdini/alpaca');
    const fmpSecret = Secret.fromSecretNameV2(this, 'FmpSecret', 'houdini/fmp');
    const anthropicSecret = Secret.fromSecretNameV2(this, 'AnthropicSecret', 'houdini/anthropic');

    // ── IAM ───────────────────────────────────────────────────────────────────
    const taskRole = new Role(this, 'TaskRole', {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    const tables = [
      props.usersTable,
      props.portfoliosTable,
      props.positionsTable,
      props.tradesTable,
      props.cronJobsTable,
      props.cronJobRunsTable,
      props.transactionsTable,
      props.portfolioEodValueHistoryTable,
      props.overviewEodValueHistoryTable,
      props.portfolioIntradayValueHistoryTable,
      props.overviewIntradayValueHistoryTable,
      props.stockResearchTable,
      props.briefingsTable,
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

    // createCronJobForPortfolio creates EventBridge schedules
    taskRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'scheduler:CreateSchedule',
          'scheduler:UpdateSchedule',
          'scheduler:GetSchedule',
          'scheduler:DeleteSchedule',
        ],
        resources: ['*'],
      }),
    );
    taskRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [props.schedulerRoleArn],
      }),
    );

    // The app consumes the cron job queue directly (receive/delete)
    props.cronJobQueue.grantConsumeMessages(taskRole);

    // Execution role — ECS agent uses this to pull the image and fetch secrets
    const executionRole = new Role(this, 'ExecutionRole', {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    alpacaSecret.grantRead(executionRole);
    fmpSecret.grantRead(executionRole);
    anthropicSecret.grantRead(executionRole);

    // ── ECS + ALB ─────────────────────────────────────────────────────────────
    const vpc = Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });
    const cluster = new Cluster(this, 'HoudiniCluster', { vpc, clusterName: 'HoudiniCluster' });

    const logGroup = new LogGroup(this, 'HoudiniLogGroup', {
      logGroupName: '/ecs/houdini',
      retention: RetentionDays.ONE_MONTH,
    });

    const service = new ApplicationLoadBalancedFargateService(this, 'HoudiniService', {
      cluster,
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
        environment: {
          AWS_REGION: this.region,
          ANTHROPIC_MODEL: 'claude-sonnet-4-6',
          STRATEGIES_BUCKET: props.strategiesBucket.bucketName,
          UPLOADS_BUCKET: props.uploadsBucket.bucketName,
          CRON_JOB_QUEUE_ARN: props.cronJobQueue.queueArn,
          SCHEDULER_ROLE_ARN: props.schedulerRoleArn,
        },
        secrets: {
          ALPACA_API_KEY: EcsSecret.fromSecretsManager(alpacaSecret, 'apiKey'),
          ALPACA_API_SECRET: EcsSecret.fromSecretsManager(alpacaSecret, 'apiSecret'),
          FMP_API_KEY: EcsSecret.fromSecretsManager(fmpSecret, 'apiKey'),
          ANTHROPIC_API_KEY: EcsSecret.fromSecretsManager(anthropicSecret, 'apiKey'),
        },
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

    this.loadBalancerDnsName = service.loadBalancer.loadBalancerDnsName;
  }
}
