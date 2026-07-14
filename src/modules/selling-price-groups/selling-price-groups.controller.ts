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
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { SaveSellingPriceGroupDto } from './dto/save-selling-price-group.dto';
import { SellingPriceGroupsService } from './selling-price-groups.service';

// GOURI gates SPG CRUD on the product perms (create/list/delete/toggle → product.create, update → product.update).
@Controller('selling-price-groups')
@UseGuards(PermissionsGuard)
export class SellingPriceGroupsController {
  constructor(private readonly groups: SellingPriceGroupsService) {}

  @Get()
  @RequirePermissions('product.view', 'product.create')
  findAll(@CurrentUser() user: AccessPayload) {
    return this.groups.findAll(user.businessId as number);
  }

  @Get('dropdown')
  @RequirePermissions('product.view', 'product.create', 'product.update')
  dropdown(@CurrentUser() user: AccessPayload) {
    return this.groups.forDropdown(user.businessId as number);
  }

  @Get(':id')
  @RequirePermissions('product.view', 'product.update')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.groups.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('product.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveSellingPriceGroupDto) {
    return this.groups.create(user.businessId as number, dto);
  }

  @Patch(':id')
  @RequirePermissions('product.update')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveSellingPriceGroupDto,
  ) {
    return this.groups.update(user.businessId as number, id, dto);
  }

  @Post(':id/toggle-active')
  @RequirePermissions('product.create')
  toggleActive(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body('isActive') isActive: boolean,
  ) {
    return this.groups.setActive(user.businessId as number, id, Boolean(isActive));
  }

  @Delete(':id')
  @RequirePermissions('product.create')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.groups.remove(user.businessId as number, id);
  }
}
