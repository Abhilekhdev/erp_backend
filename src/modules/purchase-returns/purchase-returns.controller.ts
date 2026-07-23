import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import {
  PurchaseReturnsQueryDto,
  SavePurchaseReturnDto,
  SaveReturnPaymentDto,
} from './dto/purchase-return.dto';
import { PurchaseReturnsService } from './purchase-returns.service';

/**
 * GOURI has no `purchase_return.*` permissions — returns ride on the purchase ones, and one of
 * its endpoints checks a SELL permission by mistake. We keep the purchase permissions (so no new
 * seed is needed) but apply them consistently: creating or editing a return is `purchase.update`,
 * because it changes a purchase's returned quantities and the stock behind them.
 */
@Controller('purchase-returns')
@UseGuards(PermissionsGuard)
export class PurchaseReturnsController {
  constructor(private readonly returns: PurchaseReturnsService) {}

  @Get()
  @RequirePermissions('purchase.view', 'view_own_purchase', 'purchase.update')
  list(@CurrentUser() user: AccessPayload, @Query() query: PurchaseReturnsQueryDto) {
    return this.returns.list(user, query);
  }

  /** Purchases for a supplier that still have something returnable. Must precede ':id'. */
  @Get('returnable-purchases')
  @RequirePermissions('purchase.update')
  returnablePurchases(
    @CurrentUser() user: AccessPayload,
    @Query('contact_id', ParseIntPipe) contactId: number,
  ) {
    return this.returns.returnablePurchases(user.businessId as number, contactId);
  }

  /** A purchase's lines with the per-line cap the form must respect. Must precede ':id'. */
  @Get('returnable')
  @RequirePermissions('purchase.update')
  returnable(
    @CurrentUser() user: AccessPayload,
    @Query('purchase_id', ParseIntPipe) purchaseId: number,
    @Query('exclude_return_id') excludeReturnId?: string,
  ) {
    return this.returns.returnableFor(
      user.businessId as number,
      purchaseId,
      excludeReturnId ? Number(excludeReturnId) : undefined,
    );
  }

  @Get(':id')
  @RequirePermissions('purchase.view', 'view_own_purchase', 'purchase.update')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.returns.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('purchase.update')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SavePurchaseReturnDto) {
    return this.returns.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('purchase.update')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SavePurchaseReturnDto,
  ) {
    return this.returns.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('purchase.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.returns.remove(user, id);
  }

  // ── refunds ──────────────────────────────────────────
  @Post(':id/payments')
  @RequirePermissions('purchase.payments')
  @HttpCode(200)
  addPayment(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveReturnPaymentDto,
  ) {
    return this.returns.addPayment(user, id, dto);
  }

  @Delete('payments/:paymentId')
  @RequirePermissions('delete_purchase_payment')
  @HttpCode(200)
  removePayment(
    @CurrentUser() user: AccessPayload,
    @Param('paymentId', ParseIntPipe) paymentId: number,
  ) {
    return this.returns.removePayment(user, paymentId);
  }
}
