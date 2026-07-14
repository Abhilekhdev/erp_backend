import { Module } from '@nestjs/common';
import { TaxGroupsController } from './tax-groups.controller';
import { TaxRatesController } from './tax-rates.controller';
import { TaxRatesService } from './tax-rates.service';

@Module({
  controllers: [TaxRatesController, TaxGroupsController],
  providers: [TaxRatesService],
  exports: [TaxRatesService],
})
export class TaxRatesModule {}
