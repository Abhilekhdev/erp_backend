import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { PurchaseReturnsController } from './purchase-returns.controller';
import { PurchaseReturnsService } from './purchase-returns.service';

@Module({
  imports: [AccountsModule],
  controllers: [PurchaseReturnsController],
  providers: [PurchaseReturnsService],
  exports: [PurchaseReturnsService],
})
export class PurchaseReturnsModule {}
