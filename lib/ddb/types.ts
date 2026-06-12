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
}

export enum GsiName {
  PortfoliosByUser = 'portfoliosByUser',
  CronJobsByUser = 'cronJobsByUser',
  CronJobsByPortfolio = 'cronJobsByPortfolio',
  CronJobRunsByPortfolio = 'cronJobRunsByPortfolio',
  TradesByCronJob = 'tradesByCronJob',
  TransactionsByPortfolio = 'transactionsByPortfolio',
  PortfolioEodValueHistoryByUser = 'portfolioEodValueHistoryByUser',
}
