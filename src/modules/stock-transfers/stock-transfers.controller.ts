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
import { SaveTransferDto, UpdateTransferStatusDto } from './dto/save-transfer.dto';
import { StockTransfersService } from './stock-transfers.service';

@Controller('stock-transfers')
@UseGuards(PermissionsGuard)
export class StockTransfersController {
  constructor(
    private readonly transfers: StockTransfersService,
    private readonly lookup: StockLookupService,
  ) {}

  @Get()
  @RequirePermissions('purchase.view', 'purchase.create')
  list(@CurrentUser() user: AccessPayload, @Query() query: Record<string, string>) {
    return this.transfers.list(user.businessId as number, query);
  }

  @Get('meta')
  @RequirePermissions('purchase.create')
  meta(@CurrentUser() user: AccessPayload) {
    return this.transfers.meta(user.businessId as number);
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

  @Post()
  @RequirePermissions('purchase.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveTransferDto) {
    return this.transfers.create(user, dto);
  }

  @Get(':id')
  @RequirePermissions('purchase.view')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.transfers.findOne(user.businessId as number, id);
  }

  @Post(':id/status')
  @RequirePermissions('purchase.update')
  updateStatus(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTransferStatusDto,
  ) {
    return this.transfers.updateStatus(user, id, dto.status);
  }

  @Delete(':id')
  @RequirePermissions('purchase.delete')
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.transfers.remove(user, id);
  }
}
