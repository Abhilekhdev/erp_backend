import {
  Body,
  Controller,
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
import type { AccessPayload } from '../auth/token.service';
import { SaveOpeningStockDto } from './dto/opening-stock.dto';
import { OpeningStockService } from './opening-stock.service';
import { StockHistoryService } from './stock-history.service';

@Controller('products')
@UseGuards(PermissionsGuard)
export class OpeningStockController {
  constructor(
    private readonly openingStock: OpeningStockService,
    private readonly stockHistory: StockHistoryService,
  ) {}

  // ── opening stock ─────────────────────────────────────
  @Get(':id/opening-stock')
  @RequirePermissions('product.opening_stock')
  getOpeningStock(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.openingStock.get(user.businessId as number, id);
  }

  @Post(':id/opening-stock')
  @RequirePermissions('product.opening_stock')
  saveOpeningStock(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveOpeningStockDto,
  ) {
    return this.openingStock.save(user, id, dto);
  }

  // ── stock history ─────────────────────────────────────
  @Get(':id/stock-history/meta')
  @RequirePermissions('product.view')
  historyMeta(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.stockHistory.meta(user.businessId as number, id);
  }

  @Get(':id/stock-history')
  @RequirePermissions('product.view')
  history(
    @CurrentUser() user: AccessPayload,
    @Query('variation_id', ParseIntPipe) variationId: number,
    @Query('location_id', ParseIntPipe) locationId: number,
  ) {
    // `:id` is the product for the meta call; the ledger keys off variation + location, both from
    // the dropdowns the meta call populated.
    return this.stockHistory.history(user.businessId as number, variationId, locationId);
  }
}
