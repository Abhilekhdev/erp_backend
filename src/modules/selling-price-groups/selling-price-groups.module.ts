import { Module } from '@nestjs/common';
import { SellingPriceGroupsController } from './selling-price-groups.controller';
import { SellingPriceGroupsService } from './selling-price-groups.service';

@Module({
  controllers: [SellingPriceGroupsController],
  providers: [SellingPriceGroupsService],
  exports: [SellingPriceGroupsService],
})
export class SellingPriceGroupsModule {}
