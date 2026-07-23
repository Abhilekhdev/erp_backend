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
import { SalesOrdersQueryDto, SaveSalesOrderDto, UpdateSoShippingDto } from './dto/sales-order.dto';
import { SalesOrdersService } from './sales-orders.service';

@Controller('sales-orders')
@UseGuards(PermissionsGuard)
export class SalesOrdersController {
  constructor(private readonly orders: SalesOrdersService) {}

  @Get()
  @RequirePermissions('so.view_all', 'so.view_own', 'so.create')
  list(@CurrentUser() user: AccessPayload, @Query() query: SalesOrdersQueryDto) {
    return this.orders.list(user, query);
  }

  /** Open orders for a customer — what the sell form pulls from. Must precede ':id'. */
  @Get('open')
  @RequirePermissions('sell.create', 'direct_sell.access', 'sell.update')
  open(
    @CurrentUser() user: AccessPayload,
    @Query('contact_id', ParseIntPipe) contactId: number,
    @Query('location_id') locationId?: string,
  ) {
    return this.orders.openForCustomer(user, contactId, locationId ? Number(locationId) : undefined);
  }

  @Get(':id')
  @RequirePermissions('so.view_all', 'so.view_own', 'so.update')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.orders.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('so.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveSalesOrderDto) {
    return this.orders.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('so.update')
  update(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: SaveSalesOrderDto) {
    return this.orders.update(user, id, dto);
  }

  @Post(':id/shipping')
  @RequirePermissions('so.update')
  @HttpCode(200)
  updateShipping(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSoShippingDto) {
    return this.orders.updateShipping(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('so.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.orders.remove(user, id);
  }
}
