import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { StockLookupService } from '../../common/services/stock-lookup.service';
import type { AccessPayload } from '../auth/token.service';
import { SaveAdjustmentDto } from './dto/save-adjustment.dto';
import { StockAdjustmentsService } from './stock-adjustments.service';

@Controller('stock-adjustments')
@UseGuards(PermissionsGuard)
export class StockAdjustmentsController {
  constructor(
    private readonly adjustments: StockAdjustmentsService,
    private readonly lookup: StockLookupService,
  ) {}

  @Get()
  @RequirePermissions('purchase.view', 'purchase.create')
  list(@CurrentUser() user: AccessPayload, @Query() query: Record<string, string>) {
    return this.adjustments.list(user.businessId as number, query);
  }

  @Get('meta')
  @RequirePermissions('purchase.create')
  meta(@CurrentUser() user: AccessPayload) {
    return this.adjustments.meta(user.businessId as number);
  }

  @Get('products')
  @RequirePermissions('purchase.create')
  products(
    @CurrentUser() user: AccessPayload,
    @Query('locationId', ParseIntPipe) locationId: number,
    @Query('search') search = '',
  ) {
    return this.lookup.searchVariations(user.businessId as number, locationId, search);
  }

  @Get('lots')
  @RequirePermissions('purchase.create')
  lots(
    @CurrentUser() user: AccessPayload,
    @Query('locationId', ParseIntPipe) locationId: number,
    @Query('variationId', ParseIntPipe) variationId: number,
  ) {
    return this.lookup.lots(user.businessId as number, locationId, variationId);
  }

  @Post()
  @RequirePermissions('purchase.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveAdjustmentDto) {
    return this.adjustments.create(user, dto);
  }

  @Get(':id')
  @RequirePermissions('purchase.view')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.adjustments.findOne(user.businessId as number, id);
  }

  @Delete(':id')
  @RequirePermissions('purchase.delete')
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.adjustments.remove(user, id);
  }
}
