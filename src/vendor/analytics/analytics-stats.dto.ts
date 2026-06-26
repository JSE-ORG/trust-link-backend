export interface TransactionStats {
  totalVolume: number; // Total transaction amount across all time
  activeVolume: number; // Total transaction amount for active/ongoing transactions
  totalTransactions: number; // Total number of transactions
  activeTransactions: number; // Number of active/ongoing transactions
  completedTransactions: number; // Number of completed transactions
  completionRate: number; // Percentage of completed transactions (0-100)
  disputedTransactions: number; // Number of disputed transactions
  disputeRate: number; // Percentage of disputed transactions (0-100)
  averageTransactionValue: number; // Average transaction amount
  cancelledTransactions: number; // Number of cancelled transactions
}

export interface ChannelMetrics {
  email: {
    notificationsEnabled: boolean;
  };
  sms: {
    notificationsEnabled: boolean;
  };
}

export interface AnalyticsStatsResponse {
  stats: TransactionStats;
  channels: ChannelMetrics;
  lastUpdated: string; // ISO timestamp
}
