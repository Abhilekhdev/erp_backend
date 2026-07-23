import { Module } from '@nestjs/common';
import { OpeningStockModule } from '../opening-stock/opening-stock.module';
import { OpeningStockImportService } from './import/opening-stock-import.service';
import { ProductsImportController } from './import/products-import.controller';
import { ProductsImportService } from './import/products-import.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [OpeningStockModule], // the product import posts opening stock through it
  controllers: [ProductsController, ProductsImportController],
  providers: [ProductsService, ProductsImportService, OpeningStockImportService],
  exports: [ProductsService],
})
export class ProductsModule {}
