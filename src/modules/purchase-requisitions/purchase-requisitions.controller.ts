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
import { RequisitionsQueryDto, SaveRequisitionDto } from './dto/requisition.dto';
import { PurchaseRequisitionsService } from './purchase-requisitions.service';

const ids = (v?: string): number[] | undefined =>
  v ? v.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0) : undefined;

@Controller('purchase-requisitions')
@UseGuards(PermissionsGuard)
export class PurchaseRequisitionsController {
  constructor(private readonly requisitions: PurchaseRequisitionsService) {}

  /** `view_own` also gets in — the service narrows the rows to the caller's own. */
  @Get()
  @RequirePermissions('purchase_requisition.view_all', 'purchase_requisition.view_own', 'purchase_requisition.create')
  list(@CurrentUser() user: AccessPayload, @Query() query: RequisitionsQueryDto) {
    return this.requisitions.list(user, query);
  }

  /** Products at or below their alert quantity. Must precede ':id'. */
  @Get('low-stock')
  @RequirePermissions('purchase_requisition.create')
  lowStock(
    @CurrentUser() user: AccessPayload,
    @Query('location_id') locationId?: string,
    @Query('brand_ids') brandIds?: string,
    @Query('category_ids') categoryIds?: string,
  ) {
    return this.requisitions.lowStock(user.businessId as number, {
      locationId: locationId ? Number(locationId) : undefined,
      brandIds: ids(brandIds),
      categoryIds: ids(categoryIds),
    });
  }

  @Get(':id')
  @RequirePermissions('purchase_requisition.view_all', 'purchase_requisition.view_own')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.requisitions.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('purchase_requisition.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveRequisitionDto) {
    return this.requisitions.create(user, dto);
  }

  // No update: GOURI has no `purchase_requisition.update` permission and its edit/update methods
  // are empty stubs. A requisition is deleted and re-raised.

  @Delete(':id')
  @RequirePermissions('purchase_requisition.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.requisitions.remove(user, id);
  }
}
