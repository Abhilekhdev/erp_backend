import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { WastageTypesService, type SaveWastageTypeDto } from './wastage-types.service';

@Controller('wastage-types')
@UseGuards(PermissionsGuard)
export class WastageTypesController {
  constructor(private readonly wastageTypes: WastageTypesService) {}

  @Get()
  @RequirePermissions('wastage_type.view', 'wastage_type.create')
  list(@CurrentUser() user: AccessPayload) {
    return this.wastageTypes.findAll(user.businessId as number);
  }

  @Get('dropdown')
  @RequirePermissions('wastage_type.view', 'wastage_type.create', 'purchase.create')
  dropdown(@CurrentUser() user: AccessPayload) {
    return this.wastageTypes.dropdown(user.businessId as number);
  }

  @Post()
  @RequirePermissions('wastage_type.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveWastageTypeDto) {
    return this.wastageTypes.create(user.businessId as number, user.sub, dto);
  }

  @Put(':id')
  @RequirePermissions('wastage_type.update')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveWastageTypeDto,
  ) {
    return this.wastageTypes.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('wastage_type.delete')
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.wastageTypes.remove(user.businessId as number, id);
  }
}
