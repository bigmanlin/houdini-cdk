export enum TableName {
  Users = 'users',
  Identities = 'identities',
  Portfolios = 'portfolios',
  Positions = 'positions',
  Trades = 'trades',
  CronJobs = 'cronJobs',
  CronJobRuns = 'cronJobRuns',
  PortfolioEodValueHistory = 'portfolioEodValueHistory',
  OverviewEodValueHistory = 'overviewEodValueHistory',
  PortfolioIntradayValueHistory = 'portfolioIntradayValueHistory',
  OverviewIntradayValueHistory = 'overviewIntradayValueHistory',
  StockResearch = 'stockResearch',
  Briefing = 'briefing',
  BrokerConnections = 'brokerConnections',
}

export enum GsiName {
  IdentitiesByUser = 'identitiesByUser',
  PortfoliosByUser = 'portfoliosByUser',
  CronJobsByUser = 'cronJobsByUser',
  CronJobsByPortfolio = 'cronJobsByPortfolio',
  CronJobRunsByPortfolio = 'cronJobRunsByPortfolio',
  CronJobRunsByTime = 'cronJobRunsByTime',
  RunsByPortfolioTime = 'runsByPortfolioTime',
  TradesByCronJob = 'tradesByCronJob',
  TradesByPortfolioTime = 'tradesByPortfolioTime',
  PortfolioEodValueHistoryByUser = 'portfolioEodValueHistoryByUser',
}
