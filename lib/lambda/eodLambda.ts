import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { join } from 'path';

interface EodLambdaStackProps extends StackProps {
  portfoliosTable: Table;
  positionsTable: Table;
  portfolioEodValueHistoryTable: Table;
  overviewEodValueHistoryTable: Table;
}

export class EodLambdaStack extends Stack {
  public readonly eodFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: EodLambdaStackProps) {
    super(scope, id, props);

    const alpacaSecret = Secret.fromSecretNameV2(this, 'AlpacaSecret', 'houdini/alpaca');

    const executionRole = new Role(this, 'EodExecutionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    alpacaSecret.grantRead(executionRole);

    this.eodFunction = new NodejsFunction(this, 'EodFunction', {
      functionName: 'houdini-eod',
      runtime: Runtime.NODEJS_22_X,
      entry: join(__dirname, '../../lambda/eod/index.ts'),
      handler: 'handler',
      timeout: Duration.minutes(15),
      memorySize: 512,
      role: executionRole,
      environment: {
        PORTFOLIOS_TABLE: props.portfoliosTable.tableName,
        POSITIONS_TABLE: props.positionsTable.tableName,
        PORTFOLIO_EOD_VALUE_HISTORY_TABLE: props.portfolioEodValueHistoryTable.tableName,
        OVERVIEW_EOD_VALUE_HISTORY_TABLE: props.overviewEodValueHistoryTable.tableName,
      },
    });

    props.portfoliosTable.grantReadData(this.eodFunction);
    props.positionsTable.grantReadData(this.eodFunction);
    props.portfolioEodValueHistoryTable.grantWriteData(this.eodFunction);
    props.overviewEodValueHistoryTable.grantWriteData(this.eodFunction);

    // Allow EventBridge Scheduler to invoke this Lambda
    this.eodFunction.addPermission('EventBridgeInvoke', {
      principal: new ServicePrincipal('scheduler.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceAccount: this.account,
    });
  }
}
