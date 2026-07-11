export enum TableName {
  Users = 'users',
  Portfolios = 'portfolios',
  Positions = 'positions',
  Trades = 'trades',
  CronJobs = 'cronJobs',
  CronJobRuns = 'cronJobRuns',
  Transactions = 'transactions',
  PortfolioEodValueHistory = 'portfolioEodValueHistory',
  OverviewEodValueHistory = 'overviewEodValueHistory',
  PortfolioIntradayValueHistory = 'portfolioIntradayValueHistory',
  OverviewIntradayValueHistory = 'overviewIntradayValueHistory',
  StockResearch = 'stockResearch',
  Briefings = 'briefings',
}

export enum GsiName {
  PortfoliosByUser = 'portfoliosByUser',
  CronJobsByUser = 'cronJobsByUser',
  CronJobsByPortfolio = 'cronJobsByPortfolio',
  CronJobRunsByPortfolio = 'cronJobRunsByPortfolio',
  CronJobRunsByTime = 'cronJobRunsByTime',
  RunsByPortfolioTime = 'runsByPortfolioTime',
  TradesByCronJob = 'tradesByCronJob',
  TradesByPortfolioTime = 'tradesByPortfolioTime',
  TransactionsByPortfolio = 'transactionsByPortfolio',
  PortfolioEodValueHistoryByUser = 'portfolioEodValueHistoryByUser',
}
