import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { SaveRefundDto, SaveSellReturnDto, SellReturnsQueryDto } from './dto/sell-return.dto';
import { SellReturnsService } from './sell-returns.service';

@Controller('sell-returns')
@UseGuards(PermissionsGuard)
export class SellReturnsController {
  constructor(private readonly returns: SellReturnsService) {}

  @Get()
  @RequirePermissions('access_sell_return', 'access_own_sell_return', 'sell.view')
  list(@CurrentUser() user: AccessPayload, @Query() query: SellReturnsQueryDto) {
    return this.returns.list(user, query);
  }

  /** Sales for a customer that still have something returnable. Must precede ':id'. */
  @Get('returnable-sells')
  @RequirePermissions('access_sell_return', 'access_own_sell_return', 'sell.create')
  returnableSells(@CurrentUser() user: AccessPayload, @Query('contact_id', ParseIntPipe) contactId: number) {
    return this.returns.returnableSells(user.businessId as number, contactId);
  }

  /** A sale's lines with the per-line cap the form must respect. Must precede ':id'. */
  @Get('returnable')
  @RequirePermissions('access_sell_return', 'access_own_sell_return', 'sell.create')
  returnable(
    @CurrentUser() user: AccessPayload,
    @Query('sell_id', ParseIntPipe) sellId: number,
    @Query('exclude_return_id') excludeReturnId?: string,
  ) {
    return this.returns.returnableFor(user.businessId as number, sellId, excludeReturnId ? Number(excludeReturnId) : undefined);
  }

  @Get(':id')
  @RequirePermissions('access_sell_return', 'access_own_sell_return')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.returns.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('access_sell_return')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveSellReturnDto) {
    return this.returns.create(user, dto);
  }

  @Delete(':id')
  @RequirePermissions('access_sell_return')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.returns.remove(user, id);
  }

  // ── refunds ──────────────────────────────────────────
  @Post(':id/payments')
  @RequirePermissions('sell.payments')
  @HttpCode(200)
  addRefund(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: SaveRefundDto) {
    return this.returns.addRefund(user, id, dto);
  }

  @Delete('payments/:paymentId')
  @RequirePermissions('delete_sell_payment')
  @HttpCode(200)
  removeRefund(@CurrentUser() user: AccessPayload, @Param('paymentId', ParseIntPipe) paymentId: number) {
    return this.returns.removeRefund(user, paymentId);
  }
}
