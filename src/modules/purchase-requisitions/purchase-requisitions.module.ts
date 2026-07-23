import { Module } from '@nestjs/common';
import { PurchaseRequisitionsController } from './purchase-requisitions.controller';
import { PurchaseRequisitionsService } from './purchase-requisitions.service';

@Module({
  controllers: [PurchaseRequisitionsController],
  providers: [PurchaseRequisitionsService],
  exports: [PurchaseRequisitionsService],
})
export class PurchaseRequisitionsModule {}
