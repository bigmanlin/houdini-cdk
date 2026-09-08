import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DdbStack } from '../lib/ddb/ddb';
import { TableName, GsiName } from '../lib/ddb/types';

describe('DdbStack', () => {
  const app = new App();
  const stack = new DdbStack(app, 'TestDdbStack');
  const template = Template.fromStack(stack);

  test('creates 13 tables', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 13);
  });

  test('agents table is keyed by agent with a portfolio index and a TTL', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: TableName.Agents,
      KeySchema: [{ AttributeName: 'agentId', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: GsiName.AgentsByPortfolio,
          KeySchema: [{ AttributeName: 'portfolioId', KeyType: 'HASH' }],
        },
      ],
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });

  test('activity table is keyed by agent and instant, with a portfolio index in time order', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: TableName.Activity,
      KeySchema: [
        { AttributeName: 'agentId', KeyType: 'HASH' },
        { AttributeName: 'at', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: GsiName.ActivityByPortfolio,
          KeySchema: [
            { AttributeName: 'portfolioId', KeyType: 'HASH' },
            { AttributeName: 'at', KeyType: 'RANGE' },
          ],
        },
      ],
    });
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

  test('identities table is keyed on identityKey with a userId GSI', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: TableName.Identities,
      KeySchema: [{ AttributeName: 'identityKey', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: GsiName.IdentitiesByUser,
          KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
        },
      ],
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

  test('bookPositions table is keyed by agent and symbol', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: TableName.BookPositions,
      KeySchema: [
        { AttributeName: 'agentId', KeyType: 'HASH' },
        { AttributeName: 'symbol', KeyType: 'RANGE' },
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
