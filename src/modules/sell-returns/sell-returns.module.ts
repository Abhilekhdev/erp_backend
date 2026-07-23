import { Module } from '@nestjs/common';
import { SellReturnsController } from './sell-returns.controller';
import { SellReturnsService } from './sell-returns.service';

@Module({
  controllers: [SellReturnsController],
  providers: [SellReturnsService],
  exports: [SellReturnsService],
})
export class SellReturnsModule {}
