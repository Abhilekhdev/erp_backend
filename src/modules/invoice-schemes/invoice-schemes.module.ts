import { Module } from '@nestjs/common';
import { InvoiceSchemesController } from './invoice-schemes.controller';
import { InvoiceSchemesService } from './invoice-schemes.service';

@Module({
  controllers: [InvoiceSchemesController],
  providers: [InvoiceSchemesService],
  exports: [InvoiceSchemesService],
})
export class InvoiceSchemesModule {}
