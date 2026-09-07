export enum TableName {
  Users = 'users',
  Identities = 'identities',
  Portfolios = 'portfolios',
  Positions = 'positions',
  Agents = 'agents',
  Activity = 'activity',
  PortfolioEodValueHistory = 'portfolioEodValueHistory',
  OverviewEodValueHistory = 'overviewEodValueHistory',
  PortfolioIntradayValueHistory = 'portfolioIntradayValueHistory',
  OverviewIntradayValueHistory = 'overviewIntradayValueHistory',
  BrokerConnections = 'brokerConnections',
  DeviceTokens = 'deviceTokens',
}

export enum GsiName {
  IdentitiesByUser = 'identitiesByUser',
  PortfoliosByUser = 'portfoliosByUser',
  AgentsByPortfolio = 'agentsByPortfolio',
  ActivityByPortfolio = 'activityByPortfolio',
  PortfolioEodValueHistoryByUser = 'portfolioEodValueHistoryByUser',
}
