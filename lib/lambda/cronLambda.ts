import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

const BATCH_SIZE = 1;

interface CronLambdaStackProps extends StackProps {
  cronJobQueue: Queue;
  strategiesBucket: Bucket;
  usersTable: Table;
  portfoliosTable: Table;
  positionsTable: Table;
  tradesTable: Table;
  cronJobsTable: Table;
  cronJobRunsTable: Table;
  transactionsTable: Table;
}

export class CronLambdaStack extends Stack {
  public readonly executionFunction: Function;

  constructor(scope: Construct, id: string, props: CronLambdaStackProps) {
    super(scope, id, props);

    const executionRole = new Role(this, 'CronExecutionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    this.executionFunction = new Function(this, 'CronExecutionFunction', {
      functionName: 'houdini-cron-execution',
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
      timeout: Duration.minutes(5),
      role: executionRole,
      environment: {
        STRATEGIES_BUCKET: props.strategiesBucket.bucketName,
        USERS_TABLE: props.usersTable.tableName,
        PORTFOLIOS_TABLE: props.portfoliosTable.tableName,
        POSITIONS_TABLE: props.positionsTable.tableName,
        TRADES_TABLE: props.tradesTable.tableName,
        CRON_JOBS_TABLE: props.cronJobsTable.tableName,
        CRON_JOB_RUNS_TABLE: props.cronJobRunsTable.tableName,
        TRANSACTIONS_TABLE: props.transactionsTable.tableName,
      },
    });

    this.executionFunction.addEventSource(
      new SqsEventSource(props.cronJobQueue, { batchSize: BATCH_SIZE }),
    );

    props.strategiesBucket.grantRead(executionRole);
    props.usersTable.grantReadWriteData(executionRole);
    props.portfoliosTable.grantReadWriteData(executionRole);
    props.positionsTable.grantReadWriteData(executionRole);
    props.tradesTable.grantReadWriteData(executionRole);
    props.cronJobsTable.grantReadWriteData(executionRole);
    props.cronJobRunsTable.grantReadWriteData(executionRole);
    props.transactionsTable.grantReadWriteData(executionRole);
  }
}
