import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table, ProjectionType } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { TableName, GsiName } from './types';

// Continuous backups for the durable tables: RETAIN survives a stack delete,
// but only PITR protects against a bad write or a console delete. The TTL'd,
// rebuildable tables (intraday snapshots, stockResearch) are left out.
const PITR = {
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
};

export class DdbStack extends Stack {
  public readonly usersTable: Table;
  public readonly identitiesTable: Table;
  public readonly portfoliosTable: Table;
  public readonly positionsTable: Table;
  public readonly bookPositionsTable: Table;
  public readonly agentsTable: Table;
  public readonly activityTable: Table;
  public readonly portfolioEodValueHistoryTable: Table;
  public readonly overviewEodValueHistoryTable: Table;
  public readonly portfolioIntradayValueHistoryTable: Table;
  public readonly overviewIntradayValueHistoryTable: Table;
  public readonly brokerConnectionsTable: Table;
  public readonly deviceTokensTable: Table;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.usersTable = new Table(this, 'UsersTable', {
      tableName: TableName.Users,
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      ...PITR,
    });

    // One row per way of signing in — `sub#<auth0 sub>` and `email#<address>` — each
    // pointing at the userId that owns it. The email row doubles as the uniqueness
    // constraint behind "one verified email, one account": DynamoDB enforces it on the
    // partition key, which is the only place it can be enforced at all.
    this.identitiesTable = new Table(this, 'IdentitiesTable', {
      tableName: TableName.Identities,
      partitionKey: { name: 'identityKey', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      ...PITR,
    });

    // Account deletion has the userId and needs every identity row that points at it.
    this.identitiesTable.addGlobalSecondaryIndex({
      indexName: GsiName.IdentitiesByUser,
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      projectionType: ProjectionType.KEYS_ONLY,
    });

    this.portfoliosTable = new Table(this, 'PortfoliosTable', {
      tableName: TableName.Portfolios,
      partitionKey: { name: 'portfolioId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      ...PITR,
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
      ...PITR,
    });

    // A position belongs to one agent's book, not to the account: several agents
    // may hold the same symbol on one account, and each keeps its own quantity
    // and cost. The account's own holdings are the venue's total less every book.
    this.bookPositionsTable = new Table(this, 'BookPositionsTable', {
      tableName: TableName.BookPositions,
      partitionKey: { name: 'agentId', type: AttributeType.STRING },
      sortKey: { name: 'symbol', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      ...PITR,
    });

    // A strategy deployed on an account: its schedule, status, and last wake.
    // One live agent per account; archived ones stay as the record behind
    // their activity, found through the account they traded.
    this.agentsTable = new Table(this, 'AgentsTable', {
      tableName: TableName.Agents,
      partitionKey: { name: 'agentId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
      ...PITR,
    });

    this.agentsTable.addGlobalSecondaryIndex({
      indexName: GsiName.AgentsByPortfolio,
      partitionKey: { name: 'portfolioId', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // What an agent did, one row per event: a review, an entry, an exit, a
    // refusal, a rebuild. A wake that found nothing writes no row. The feed
    // reads an agent's rows newest first; the portfolio page reads across agents.
    this.activityTable = new Table(this, 'ActivityTable', {
      tableName: TableName.Activity,
      partitionKey: { name: 'agentId', type: AttributeType.STRING },
      sortKey: { name: 'at', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      ...PITR,
    });

    this.activityTable.addGlobalSecondaryIndex({
      indexName: GsiName.ActivityByPortfolio,
      partitionKey: { name: 'portfolioId', type: AttributeType.STRING },
      sortKey: { name: 'at', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.portfolioEodValueHistoryTable = new Table(this, 'PortfolioEodValueHistoryTable', {
      tableName: TableName.PortfolioEodValueHistory,
      partitionKey: { name: 'portfolioId', type: AttributeType.STRING },
      sortKey: { name: 'date', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      ...PITR,
    });

    this.portfolioEodValueHistoryTable.addGlobalSecondaryIndex({
      indexName: GsiName.PortfolioEodValueHistoryByUser,
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      sortKey: { name: 'date', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.overviewEodValueHistoryTable = new Table(this, 'OverviewEodValueHistoryTable', {
      tableName: TableName.OverviewEodValueHistory,
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      sortKey: { name: 'date', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      ...PITR,
    });

    // Intraday tables hold 30-min value snapshots, keyed by slot boundary;
    // rows carry a `ttl` attribute (~7 days) so DynamoDB reaps them itself.
    this.portfolioIntradayValueHistoryTable = new Table(this, 'PortfolioIntradayValueHistoryTable', {
      tableName: TableName.PortfolioIntradayValueHistory,
      partitionKey: { name: 'portfolioId', type: AttributeType.STRING },
      sortKey: { name: 'slotTimestamp', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    });

    this.overviewIntradayValueHistoryTable = new Table(this, 'OverviewIntradayValueHistoryTable', {
      tableName: TableName.OverviewIntradayValueHistory,
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      sortKey: { name: 'slotTimestamp', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    });

    // Brokerage OAuth: live connections and the short-lived attempts that create
    // them, separated by a key prefix. The TTL only reaps abandoned attempts —
    // a completed one is deleted as it is exchanged, and connections carry no
    // expiry attribute at all.
    this.brokerConnectionsTable = new Table(this, 'BrokerConnectionsTable', {
      tableName: TableName.BrokerConnections,
      partitionKey: { name: 'connectionKey', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'expiresAtEpoch',
      ...PITR,
    });

    // One row per device a user has the app on, so a notification reaches every
    // one of them. Apple retires a token whenever the app is reinstalled or
    // moved between build environments, and the sender deletes what it is told
    // is gone — the table is a cache of live tokens, never a record to keep.
    this.deviceTokensTable = new Table(this, 'DeviceTokensTable', {
      tableName: TableName.DeviceTokens,
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      sortKey: { name: 'token', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
