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
  SaveSellDto,
  SavePaymentDto,
  SellsQueryDto,
  UpdateSellStatusDto,
} from './dto/sell.dto';
import { SellsMetaService } from './sells-meta.service';
import { SellsService } from './sells.service';

@Controller('sells')
@UseGuards(PermissionsGuard)
export class SellsController {
  constructor(
    private readonly sells: SellsService,
    private readonly meta: SellsMetaService,
  ) {}

  /** `view_own_sell_only` also gets in — the service narrows the rows to the caller's own. */
  @Get()
  @RequirePermissions('sell.view', 'direct_sell.view', 'view_own_sell_only', 'direct_sell.access')
  list(@CurrentUser() user: AccessPayload, @Query() query: SellsQueryDto) {
    return this.sells.list(user, query);
  }

  /** Dropdowns + business toggles for the sell form. Must precede ':id'. */
  @Get('meta')
  @RequirePermissions('sell.view', 'direct_sell.view', 'direct_sell.access', 'sell.create')
  metaData(@CurrentUser() user: AccessPayload) {
    return this.meta.meta(user.businessId as number);
  }

  /** Product picker for the sell line table. Must precede ':id'. */
  @Get('products')
  @RequirePermissions('sell.create', 'direct_sell.access', 'sell.update')
  searchProducts(
    @CurrentUser() user: AccessPayload,
    @Query('search') search?: string,
    @Query('location_id') locationId?: string,
    @Query('price_group_id') priceGroupId?: string,
  ) {
    return this.meta.searchProducts(
      user.businessId as number,
      search ?? '',
      locationId ? Number(locationId) : undefined,
      priceGroupId ? Number(priceGroupId) : undefined,
    );
  }

  @Get(':id')
  @RequirePermissions('sell.view', 'direct_sell.view', 'view_own_sell_only', 'direct_sell.access', 'sell.update')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.sells.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('sell.create', 'direct_sell.access')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveSellDto) {
    return this.sells.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('sell.update', 'direct_sell.update')
  update(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: SaveSellDto) {
    return this.sells.update(user, id, dto);
  }

  @Post(':id/status')
  @RequirePermissions('sell.update', 'direct_sell.update')
  @HttpCode(200)
  updateStatus(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSellStatusDto,
  ) {
    return this.sells.updateStatus(user, id, dto.status);
  }

  @Delete(':id')
  @RequirePermissions('sell.delete', 'direct_sell.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.sells.remove(user, id);
  }

  // ── payments ─────────────────────────────────────────
  @Get(':id/payments')
  @RequirePermissions('sell.view', 'direct_sell.view', 'sell.payments')
  listPayments(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.sells.listPayments(user.businessId as number, id);
  }

  @Post(':id/payments')
  @RequirePermissions('sell.payments')
  @HttpCode(200)
  addPayment(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: SavePaymentDto) {
    return this.sells.addPayment(user, id, dto);
  }

  @Delete('payments/:paymentId')
  @RequirePermissions('delete_sell_payment')
  @HttpCode(200)
  removePayment(@CurrentUser() user: AccessPayload, @Param('paymentId', ParseIntPipe) paymentId: number) {
    return this.sells.removePayment(user, paymentId);
  }
}
