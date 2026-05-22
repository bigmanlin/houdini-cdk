import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sm = new SecretsManagerClient({});

const PORTFOLIOS_TABLE = process.env.PORTFOLIOS_TABLE!;
const POSITIONS_TABLE = process.env.POSITIONS_TABLE!;
const PORTFOLIO_EOD_TABLE = process.env.PORTFOLIO_EOD_VALUE_HISTORY_TABLE!;
const OVERVIEW_EOD_TABLE = process.env.OVERVIEW_EOD_VALUE_HISTORY_TABLE!;
const ALPACA_BASE_URL = 'https://data.alpaca.markets/v2';
// Alpaca snapshot API accepts up to 100 symbols per request
const ALPACA_SYMBOL_BATCH_SIZE = 100;
// DDB BatchWriteItem accepts up to 25 items per request
const DDB_WRITE_BATCH_SIZE = 25;

interface Portfolio {
  portfolioId: string;
  userId: string;
  cashBalance: number;
}

interface Position {
  portfolioId: string;
  symbol: string;
  quantity: number;
}

// Returns today's date in ET timezone as YYYY-MM-DD (market close date)
function todayEt(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// Fetches Alpaca API credentials from Secrets Manager at runtime
async function getAlpacaCredentials(): Promise<{ apiKey: string; apiSecret: string }> {
  const result = await sm.send(new GetSecretValueCommand({ SecretId: 'houdini/alpaca' }));
  return JSON.parse(result.SecretString!) as { apiKey: string; apiSecret: string };
}

// Scans all portfolios from DDB, paginating until all pages are consumed
async function getAllPortfolios(): Promise<Portfolio[]> {
  const portfolios: Portfolio[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: PORTFOLIOS_TABLE,
        ProjectionExpression: 'portfolioId, userId, cashBalance',
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    portfolios.push(...((result.Items ?? []) as Portfolio[]));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return portfolios;
}

// Queries all positions for each portfolio concurrently.
// BatchGetItem is not used here because it requires knowing exact PK+SK pairs upfront —
// we only know portfolioId, not which symbols each portfolio holds.
async function getPositionsForPortfolios(
  portfolioIds: string[],
): Promise<Map<string, Position[]>> {
  const positionsByPortfolio = new Map<string, Position[]>();

  await Promise.all(
    portfolioIds.map(async (portfolioId) => {
      const result = await ddb.send(
        new QueryCommand({
          TableName: POSITIONS_TABLE,
          KeyConditionExpression: 'portfolioId = :portfolioId',
          ExpressionAttributeValues: { ':portfolioId': portfolioId },
        }),
      );
      positionsByPortfolio.set(portfolioId, (result.Items ?? []) as Position[]);
    }),
  );

  return positionsByPortfolio;
}

// Fetches EOD closing prices from Alpaca for all unique tickers.
// Batched at 100 symbols per request to respect the Alpaca API limit.
async function getClosingPrices(
  tickers: string[],
  apiKey: string,
  apiSecret: string,
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();

  for (let i = 0; i < tickers.length; i += ALPACA_SYMBOL_BATCH_SIZE) {
    const batch = tickers.slice(i, i + ALPACA_SYMBOL_BATCH_SIZE);
    const symbols = batch.join(',');
    const res = await fetch(`${ALPACA_BASE_URL}/stocks/snapshots?symbols=${symbols}&feed=iex`, {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Alpaca snapshot request failed — status: ${res.status} ${res.statusText}, symbols: [${symbols}], response: ${body}`,
      );
    }

    // dailyBar.c is the closing price for the trading day
    const data = (await res.json()) as Record<string, { dailyBar: { c: number } }>;
    for (const [symbol, snapshot] of Object.entries(data)) {
      prices.set(symbol, snapshot.dailyBar.c);
    }
  }

  return prices;
}

// Writes items to DDB in batches of 25 (BatchWriteItem limit) sequentially
async function batchWrite(tableName: string, items: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < items.length; i += DDB_WRITE_BATCH_SIZE) {
    const batch = items.slice(i, i + DDB_WRITE_BATCH_SIZE);
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: batch.map((item) => ({ PutRequest: { Item: item } })),
        },
      }),
    );
  }
}

export const handler = async (): Promise<void> => {
  const date = todayEt();

  // Step 1: Fetch all portfolios and Alpaca credentials concurrently
  const [portfolios, { apiKey, apiSecret }] = await Promise.all([
    getAllPortfolios(),
    getAlpacaCredentials(),
  ]);

  // Step 2: Fetch all positions for every portfolio concurrently
  const positionsByPortfolio = await getPositionsForPortfolios(
    portfolios.map((p) => p.portfolioId),
  );

  // Step 3: Collect unique tickers across all portfolios for a single batch price fetch
  const uniqueTickers = [
    ...new Set(
      [...positionsByPortfolio.values()].flatMap((positions) => positions.map((p) => p.symbol)),
    ),
  ];

  // Step 4: Fetch closing prices from Alpaca for all unique tickers
  const prices = await getClosingPrices(uniqueTickers, apiKey, apiSecret);

  // Step 5: Compute EOD value for each portfolio and aggregate by user for overview.
  // Both are computed in a single pass to avoid iterating portfolios twice.
  const portfolioEodItems: Record<string, unknown>[] = [];
  const overviewByUser = new Map<string, number>();

  for (const portfolio of portfolios) {
    const positions = positionsByPortfolio.get(portfolio.portfolioId) ?? [];
    const positionsValue = positions.reduce(
      (sum, pos) => sum + pos.quantity * (prices.get(pos.symbol) ?? 0),
      0,
    );
    const totalValue = portfolio.cashBalance + positionsValue;

    portfolioEodItems.push({
      portfolioId: portfolio.portfolioId,
      date,
      value: totalValue,
      userId: portfolio.userId,
    });

    overviewByUser.set(
      portfolio.userId,
      (overviewByUser.get(portfolio.userId) ?? 0) + totalValue,
    );
  }

  const overviewEodItems: Record<string, unknown>[] = [...overviewByUser.entries()].map(
    ([userId, value]) => ({ userId, date, value }),
  );

  // Step 6: Write portfolio and overview snapshots to DDB concurrently
  await Promise.all([
    batchWrite(PORTFOLIO_EOD_TABLE, portfolioEodItems),
    batchWrite(OVERVIEW_EOD_TABLE, overviewEodItems),
  ]);

  console.log(
    `EOD complete: ${portfolios.length} portfolios, ${overviewByUser.size} users, date=${date}`,
  );
};
