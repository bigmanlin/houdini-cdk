import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table, ProjectionType } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { TableName, GsiName } from './types';

export class DdbStack extends Stack {
  public readonly usersTable: Table;
  public readonly portfoliosTable: Table;
  public readonly positionsTable: Table;
  public readonly tradesTable: Table;
  public readonly cronJobsTable: Table;
  public readonly cronJobRunsTable: Table;
  public readonly transactionsTable: Table;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.usersTable = new Table(this, 'UsersTable', {
      tableName: TableName.Users,
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.portfoliosTable = new Table(this, 'PortfoliosTable', {
      tableName: TableName.Portfolios,
      partitionKey: { name: 'portfolioId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.portfoliosTable.addGlobalSecondaryIndex({
      indexName: GsiName.PortfoliosByUser,
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.positionsTable = new Table(this, 'PositionsTable', {
      tableName: TableName.Positions,
      partitionKey: { name: 'portfolioId', type: AttributeType.STRING },
      sortKey: { name: 'symbol', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.tradesTable = new Table(this, 'TradesTable', {
      tableName: TableName.Trades,
      partitionKey: { name: 'portfolioId', type: AttributeType.STRING },
      sortKey: { name: 'tradeId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.tradesTable.addGlobalSecondaryIndex({
      indexName: GsiName.TradesByCronJob,
      partitionKey: { name: 'cronJobId', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.cronJobsTable = new Table(this, 'CronJobsTable', {
      tableName: TableName.CronJobs,
      partitionKey: { name: 'cronJobId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.cronJobsTable.addGlobalSecondaryIndex({
      indexName: GsiName.CronJobsByUser,
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.cronJobsTable.addGlobalSecondaryIndex({
      indexName: GsiName.CronJobsByPortfolio,
      partitionKey: { name: 'portfolioId', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.cronJobRunsTable = new Table(this, 'CronJobRunsTable', {
      tableName: TableName.CronJobRuns,
      partitionKey: { name: 'cronJobId', type: AttributeType.STRING },
      sortKey: { name: 'runId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.cronJobRunsTable.addGlobalSecondaryIndex({
      indexName: GsiName.CronJobRunsByPortfolio,
      partitionKey: { name: 'portfolioId', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.transactionsTable = new Table(this, 'TransactionsTable', {
      tableName: TableName.Transactions,
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      sortKey: { name: 'transactionId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.transactionsTable.addGlobalSecondaryIndex({
      indexName: GsiName.TransactionsByPortfolio,
      partitionKey: { name: 'portfolioId', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
  }
}
