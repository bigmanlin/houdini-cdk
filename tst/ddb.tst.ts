import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DdbStack } from '../lib/ddb/ddb';
import { TableName, GsiName } from '../lib/ddb/types';

describe('DdbStack', () => {
  const app = new App();
  const stack = new DdbStack(app, 'TestDdbStack');
  const template = Template.fromStack(stack);

  test('creates 9 tables', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 9);
  });

  test('all tables use PAY_PER_REQUEST billing', () => {
    template.allResourcesProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  test('users table has correct key schema', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: TableName.Users,
      KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
    });
  });

  test('portfolios table has userId GSI', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: TableName.Portfolios,
      GlobalSecondaryIndexes: [
        {
          IndexName: GsiName.PortfoliosByUser,
          KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
        },
      ],
    });
  });

  test('positions table has portfolioId + symbol composite key', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: TableName.Positions,
      KeySchema: [
        { AttributeName: 'portfolioId', KeyType: 'HASH' },
        { AttributeName: 'symbol', KeyType: 'RANGE' },
      ],
    });
  });

  test('trades table has cronJobId GSI', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: TableName.Trades,
      GlobalSecondaryIndexes: [
        {
          IndexName: GsiName.TradesByCronJob,
          KeySchema: [{ AttributeName: 'cronJobId', KeyType: 'HASH' }],
        },
      ],
    });
  });

  test('cronJobs table has userId and portfolioId GSIs', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: TableName.CronJobs,
      GlobalSecondaryIndexes: [
        {
          IndexName: GsiName.CronJobsByUser,
          KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
        },
        {
          IndexName: GsiName.CronJobsByPortfolio,
          KeySchema: [{ AttributeName: 'portfolioId', KeyType: 'HASH' }],
        },
      ],
    });
  });

  test('cronJobRuns table has portfolioId GSI', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: TableName.CronJobRuns,
      GlobalSecondaryIndexes: [
        {
          IndexName: GsiName.CronJobRunsByPortfolio,
          KeySchema: [{ AttributeName: 'portfolioId', KeyType: 'HASH' }],
        },
      ],
    });
  });

  test('transactions table has portfolioId GSI', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: TableName.Transactions,
      GlobalSecondaryIndexes: [
        {
          IndexName: GsiName.TransactionsByPortfolio,
          KeySchema: [{ AttributeName: 'portfolioId', KeyType: 'HASH' }],
        },
      ],
    });
  });

  test('portfolioEodValueHistory table has portfolioId + date composite key and userId GSI', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: TableName.PortfolioEodValueHistory,
      KeySchema: [
        { AttributeName: 'portfolioId', KeyType: 'HASH' },
        { AttributeName: 'date', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: GsiName.PortfolioEodValueHistoryByUser,
          KeySchema: [
            { AttributeName: 'userId', KeyType: 'HASH' },
            { AttributeName: 'date', KeyType: 'RANGE' },
          ],
        },
      ],
    });
  });

  test('overviewEodValueHistory table has userId + date composite key', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: TableName.OverviewEodValueHistory,
      KeySchema: [
        { AttributeName: 'userId', KeyType: 'HASH' },
        { AttributeName: 'date', KeyType: 'RANGE' },
      ],
    });
  });
});
