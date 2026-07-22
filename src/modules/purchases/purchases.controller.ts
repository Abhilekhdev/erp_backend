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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import {
  PurchasesQueryDto,
  SavePaymentDto,
  UpdateApprovalDto,
  UpdateStatusDto,
} from './dto/purchases-query.dto';
import { SavePurchaseDto } from './dto/save-purchase.dto';
import { PurchasesService } from './purchases.service';

@Controller('purchases')
@UseGuards(PermissionsGuard)
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  /** `view_own_purchase` also gets in — the service narrows the rows to the caller's own. */
  @Get()
  @RequirePermissions('purchase.view', 'view_own_purchase', 'purchase.create')
  list(@CurrentUser() user: AccessPayload, @Query() query: PurchasesQueryDto) {
    return this.purchases.list(user, query);
  }

  /** Dropdowns + business toggles for the purchase form. Must precede ':id'. */
  @Get('meta')
  @RequirePermissions('purchase.view', 'view_own_purchase', 'purchase.create', 'purchase.update')
  meta(@CurrentUser() user: AccessPayload) {
    return this.purchases.meta(user.businessId as number);
  }

  /** The current filter set as a spreadsheet. Must precede ':id'. */
  @Get('export')
  @RequirePermissions('purchase.view', 'view_own_purchase')
  async exportExcel(
    @CurrentUser() user: AccessPayload,
    @Query() query: PurchasesQueryDto,
    @Res() res: Response,
  ) {
    const buffer = await this.purchases.exportExcel(user, query);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="purchases-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      'Cache-Control': 'no-store',
    });
    res.end(buffer);
  }

  /** Product picker for the line table. Must precede ':id'. */
  @Get('products')
  @RequirePermissions('purchase.create', 'purchase.update')
  searchProducts(
    @CurrentUser() user: AccessPayload,
    @Query('search') search?: string,
    @Query('location_id') locationId?: string,
    @Query('contact_id') contactId?: string,
  ) {
    return this.purchases.searchProducts(
      user.businessId as number,
      search ?? '',
      locationId ? Number(locationId) : undefined,
      contactId ? Number(contactId) : undefined,
    );
  }

  @Get(':id')
  @RequirePermissions('purchase.view', 'view_own_purchase', 'purchase.update')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.purchases.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('purchase.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SavePurchaseDto) {
    return this.purchases.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('purchase.update')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SavePurchaseDto,
  ) {
    return this.purchases.update(user, id, dto);
  }

  @Post(':id/status')
  @RequirePermissions('purchase.update', 'purchase.update_status')
  @HttpCode(200)
  updateStatus(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.purchases.updateStatus(user, id, dto.status);
  }

  /** Approving posts the stock — in GOURI it silently does not. */
  @Post(':id/approval')
  @RequirePermissions('purchase.approve')
  @HttpCode(200)
  updateApproval(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateApprovalDto,
  ) {
    return this.purchases.updateApproval(user, id, dto.is_approved);
  }

  @Delete(':id')
  @RequirePermissions('purchase.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.purchases.remove(user, id);
  }

  // ── payments ─────────────────────────────────────────
  @Get(':id/payments')
  @RequirePermissions('purchase.view', 'view_own_purchase', 'purchase.payments')
  listPayments(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.purchases.listPayments(user.businessId as number, id);
  }

  @Post(':id/payments')
  @RequirePermissions('purchase.payments')
  @HttpCode(200)
  addPayment(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SavePaymentDto,
  ) {
    return this.purchases.addPayment(user, id, dto);
  }

  @Delete('payments/:paymentId')
  @RequirePermissions('delete_purchase_payment')
  @HttpCode(200)
  removePayment(@CurrentUser() user: AccessPayload, @Param('paymentId', ParseIntPipe) paymentId: number) {
    return this.purchases.removePayment(user, paymentId);
  }
}
