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
  PurchaseOrdersQueryDto,
  SavePurchaseOrderDto,
  UpdateShippingDto,
} from './dto/purchase-order.dto';
import { PurchaseOrdersService } from './purchase-orders.service';

@Controller('purchase-orders')
@UseGuards(PermissionsGuard)
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}

  @Get()
  @RequirePermissions('purchase_order.view_all', 'purchase_order.view_own', 'purchase_order.create')
  list(@CurrentUser() user: AccessPayload, @Query() query: PurchaseOrdersQueryDto) {
    return this.orders.list(user, query);
  }

  /**
   * Open orders for a supplier — what the purchase form pulls from. Must precede ':id'.
   * `purchase.create` is enough: this is a purchase-side read.
   */
  @Get('open')
  @RequirePermissions('purchase.create', 'purchase.update')
  open(
    @CurrentUser() user: AccessPayload,
    @Query('contact_id', ParseIntPipe) contactId: number,
    @Query('location_id') locationId?: string,
  ) {
    return this.orders.openForSupplier(user, contactId, locationId ? Number(locationId) : undefined);
  }

  /** Open requisitions at a location — what the order form pulls from. Must precede ':id'. */
  @Get('open-requisitions')
  @RequirePermissions('purchase_order.create', 'purchase_order.update')
  openRequisitions(
    @CurrentUser() user: AccessPayload,
    @Query('location_id', ParseIntPipe) locationId: number,
  ) {
    return this.orders.openRequisitions(user, locationId);
  }

  @Get(':id')
  @RequirePermissions('purchase_order.view_all', 'purchase_order.view_own', 'purchase_order.update')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.orders.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('purchase_order.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SavePurchaseOrderDto) {
    return this.orders.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('purchase_order.update')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SavePurchaseOrderDto,
  ) {
    return this.orders.update(user, id, dto);
  }

  @Post(':id/shipping')
  @RequirePermissions('purchase_order.update')
  @HttpCode(200)
  updateShipping(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateShippingDto,
  ) {
    return this.orders.updateShipping(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('purchase_order.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.orders.remove(user, id);
  }
}
