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
import { SaveWarrantyDto } from './dto/save-warranty.dto';
import { WarrantiesService } from './warranties.service';

// GOURI has no dedicated warranty permission — gate with product perms (part of product setup).
@Controller('warranties')
@UseGuards(PermissionsGuard)
export class WarrantiesController {
  constructor(private readonly warranties: WarrantiesService) {}

  @Get()
  @RequirePermissions('product.view', 'product.create')
  findAll(@CurrentUser() user: AccessPayload) {
    return this.warranties.findAll(user.businessId as number);
  }

  @Get('dropdown')
  @RequirePermissions('product.view', 'product.create', 'product.update')
  dropdown(@CurrentUser() user: AccessPayload) {
    return this.warranties.forDropdown(user.businessId as number);
  }

  @Get(':id')
  @RequirePermissions('product.view', 'product.update')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.warranties.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('product.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveWarrantyDto) {
    return this.warranties.create(user.businessId as number, dto);
  }

  @Patch(':id')
  @RequirePermissions('product.update')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveWarrantyDto,
  ) {
    return this.warranties.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('product.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.warranties.remove(user.businessId as number, id);
  }
}
