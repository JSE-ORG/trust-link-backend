#!/usr/bin/env ts-node
/**
 * Performance benchmark for chart aggregation optimization
 * Compares JavaScript-based aggregation vs database-level aggregation
 */

import { EscrowCreateInput, EscrowState, PrismaService } from '../src/prisma/prisma.service';

interface DailyData {
  date: string;
  totalVolume: number;
  transactionCount: number;
  completedCount: number;
  disputedCount: number;
  averageTransactionValue: number;
}

interface BenchmarkResult {
  name: string;
  duration: number;
  memoryUsed: number;
  recordCount: number;
}

class ChartAggregationBenchmark {
  private prisma: PrismaService;

  constructor() {
    this.prisma = new PrismaService();
  }

  /**
   * Old approach: Load all transactions into memory and aggregate in JavaScript
   */
  private async oldApproach(vendorAddress: string, days: number): Promise<{ data: { date: string; totalVolume: number; transactionCount: number; completedCount: number; disputedCount: number; averageTransactionValue: number }[]; recordCount: number }> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const escrows = await this.prisma.escrow.findMany({
      where: {
        vendorAddress,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        id: true,
        amount: true,
        state: true,
        createdAt: true,
      },
    });

    const dailyMap = new Map<string, DailyData>();

    for (const escrow of escrows) {
      const dateKey = this.formatDate(escrow.createdAt);

      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, {
          date: dateKey,
          totalVolume: 0,
          transactionCount: 0,
          completedCount: 0,
          disputedCount: 0,
          averageTransactionValue: 0,
        });
      }

      const daily = dailyMap.get(dateKey)!;
      const amount = Number(escrow.amount);

      daily.totalVolume += amount;
      daily.transactionCount += 1;

      if (escrow.state === 'COMPLETED' || escrow.state === 'RELEASED') {
        daily.completedCount += 1;
      }

      if (escrow.state === 'DISPUTED') {
        daily.disputedCount += 1;
      }
    }

    dailyMap.forEach((daily) => {
      daily.averageTransactionValue =
        daily.transactionCount > 0
          ? daily.totalVolume / daily.transactionCount
          : 0;
    });

    const sortedData = Array.from(dailyMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    return {
      data: sortedData,
      recordCount: escrows.length,
    };
  }

  /**
   * New approach: Database-level aggregation using raw SQL
   */
  private async newApproach(vendorAddress: string, days: number, timezone: string = 'UTC'): Promise<{ data: DailyData[]; recordCount: number }> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const aggregationResult = await this.prisma.$queryRaw<{
      date: string;
      totalVolume: number;
      transactionCount: number;
      completedCount: number;
      disputedCount: number;
    }>`
      SELECT 
        DATE("createdAt" AT TIME ZONE ${timezone})::date as date,
        COALESCE(SUM("amount"), 0) as "totalVolume",
        COUNT(*) as "transactionCount",
        SUM(CASE WHEN "state" IN ('COMPLETED', 'RELEASED') THEN 1 ELSE 0 END) as "completedCount",
        SUM(CASE WHEN "state" = 'DISPUTED' THEN 1 ELSE 0 END) as "disputedCount"
      FROM "Escrow"
      WHERE 
        "vendorAddress" = ${vendorAddress}
        AND "createdAt" >= ${startDate}
        AND "createdAt" <= ${endDate}
      GROUP BY DATE("createdAt" AT TIME ZONE ${timezone})::date
      ORDER BY date ASC
    `;

    const dailyMap = new Map<string, DailyData>();

    for (const row of aggregationResult) {
      const dateKey = row.date;
      const totalVolume = Number(row.totalVolume);
      const transactionCount = Number(row.transactionCount);
      const completedCount = Number(row.completedCount);
      const disputedCount = Number(row.disputedCount);

      dailyMap.set(dateKey, {
        date: dateKey,
        totalVolume,
        transactionCount,
        completedCount,
        disputedCount,
        averageTransactionValue: transactionCount > 0 ? totalVolume / transactionCount : 0,
      });
    }

    const filledData = this.fillDateGaps(dailyMap, startDate, endDate, timezone);
    const sortedData = filledData.sort((a, b) => a.date.localeCompare(b.date));

    return {
      data: sortedData,
      recordCount: aggregationResult.length,
    };
  }

  private fillDateGaps(
    dailyMap: Map<string, DailyData>,
    startDate: Date,
    endDate: Date,
    timezone: string = 'UTC',
  ): DailyData[] {
    const result: DailyData[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dateKey = this.formatDateInTimezone(currentDate, timezone);

      if (dailyMap.has(dateKey)) {
        result.push(dailyMap.get(dateKey)!);
      } else {
        result.push({
          date: dateKey,
          totalVolume: 0,
          transactionCount: 0,
          completedCount: 0,
          disputedCount: 0,
          averageTransactionValue: 0,
        });
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return result;
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private formatDateInTimezone(date: Date, timezone: string): string {
    return date.toLocaleDateString('en-CA', { timeZone: timezone });
  }

  /**
   * Generate test data with varying record counts
   */
  private async generateTestData(vendorAddress: string, recordCount: number): Promise<void> {
    console.log(`Generating ${recordCount} test records...`);
    
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() - 30);

    for (let i = 0; i < recordCount; i++) {
      const daysOffset = Math.floor(Math.random() * 30);
      const createdAt = new Date(baseDate);
      createdAt.setDate(createdAt.getDate() + daysOffset);

      const states = ['COMPLETED', 'RELEASED', 'DISPUTED', 'FUNDED'];
      const state = states[Math.floor(Math.random() * states.length)];

      await this.prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: `Test Item ${i}`,
          amount: Math.random() * 1000 + 50,
          currency: 'USD',
          buyerAddress: `0xBuyer${i}`,
          state: state as EscrowState,
        } as unknown as EscrowCreateInput,
      });
    }

    console.log(`Generated ${recordCount} test records`);
  }

  /**
   * Run benchmark for a specific record count
   */
  private async runBenchmark(vendorAddress: string, recordCount: number, days: number = 30): Promise<void> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Benchmark: ${recordCount} records`);
    console.log(`${'='.repeat(60)}`);

    // Generate test data
    await this.prisma.reset();
    await this.generateTestData(vendorAddress, recordCount);

    // Benchmark old approach
    const oldStartMemory = process.memoryUsage().heapUsed;
    const oldStartTime = performance.now();
    
    const oldResult = await this.oldApproach(vendorAddress, days);
    
    const oldEndTime = performance.now();
    const oldEndMemory = process.memoryUsage().heapUsed;

    const oldBenchmark: BenchmarkResult = {
      name: 'JavaScript Aggregation (Old)',
      duration: oldEndTime - oldStartTime,
      memoryUsed: oldEndMemory - oldStartMemory,
      recordCount: oldResult.recordCount,
    };

    // Benchmark new approach
    const newStartMemory = process.memoryUsage().heapUsed;
    const newStartTime = performance.now();
    
    const newResult = await this.newApproach(vendorAddress, days, 'UTC');
    
    const newEndTime = performance.now();
    const newEndMemory = process.memoryUsage().heapUsed;

    const newBenchmark: BenchmarkResult = {
      name: 'Database Aggregation (New)',
      duration: newEndTime - newStartTime,
      memoryUsed: newEndMemory - newStartMemory,
      recordCount: newResult.recordCount,
    };

    // Print results
    this.printBenchmarkResults(oldBenchmark, newBenchmark);
  }

  private printBenchmarkResults(oldResult: BenchmarkResult, newResult: BenchmarkResult): void {
    const durationImprovement = ((oldResult.duration - newResult.duration) / oldResult.duration) * 100;
    const memoryImprovement = ((oldResult.memoryUsed - newResult.memoryUsed) / oldResult.memoryUsed) * 100;

    console.log(`\n${oldResult.name}:`);
    console.log(`  Duration: ${oldResult.duration.toFixed(2)}ms`);
    console.log(`  Memory Used: ${(oldResult.memoryUsed / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  Records Processed: ${oldResult.recordCount}`);

    console.log(`\n${newResult.name}:`);
    console.log(`  Duration: ${newResult.duration.toFixed(2)}ms`);
    console.log(`  Memory Used: ${(newResult.memoryUsed / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  Records Processed: ${newResult.recordCount}`);

    console.log(`\nImprovement:`);
    console.log(`  Duration: ${durationImprovement > 0 ? '+' : ''}${durationImprovement.toFixed(2)}%`);
    console.log(`  Memory: ${memoryImprovement > 0 ? '+' : ''}${memoryImprovement.toFixed(2)}%`);
  }

  async run(): Promise<void> {
    console.log('Chart Aggregation Performance Benchmark');
    console.log('========================================\n');

    const vendorAddress = '0xBenchmarkVendor';
    const recordCounts = [100, 500, 1000, 5000];
    const days = 30;

    for (const count of recordCounts) {
      await this.runBenchmark(vendorAddress, count, days);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('Benchmark Complete');
    console.log(`${'='.repeat(60)}`);

    await this.prisma.reset();
  }
}

// Run benchmark
const benchmark = new ChartAggregationBenchmark();
benchmark.run().catch(console.error);
