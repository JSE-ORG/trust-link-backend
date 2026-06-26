export interface DailyVolumeData {
  date: string; // ISO date format (YYYY-MM-DD)
  totalVolume: number; // Total transaction amount for the day
  transactionCount: number; // Number of transactions
  completedCount: number; // Number of completed transactions
  disputedCount: number; // Number of disputed transactions
  averageTransactionValue: number; // Average transaction amount
}

export interface ChartDataResponse {
  data: DailyVolumeData[];
  period: {
    startDate: string;
    endDate: string;
  };
  summary: {
    totalVolume: number;
    totalTransactions: number;
    averageDaily: number;
  };
}
