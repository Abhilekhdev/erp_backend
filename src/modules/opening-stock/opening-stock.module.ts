import { Module } from '@nestjs/common';
import { OpeningStockController } from './opening-stock.controller';
import { OpeningStockService } from './opening-stock.service';
import { StockHistoryService } from './stock-history.service';

@Module({
  controllers: [OpeningStockController],
  providers: [OpeningStockService, StockHistoryService],
  exports: [OpeningStockService, StockHistoryService],
})
export class OpeningStockModule {}
