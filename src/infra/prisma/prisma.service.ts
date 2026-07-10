import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: ['warn', 'error'],
      // Neon is serverless — each round-trip adds latency, so a multi-write interactive transaction
      // (e.g. creating a user + roles + location access + pay components + leave balances) can blow
      // past Prisma's default 5s window and fail with "Transaction not found". Give them more room.
      transactionOptions: { maxWait: 10_000, timeout: 30_000 },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
