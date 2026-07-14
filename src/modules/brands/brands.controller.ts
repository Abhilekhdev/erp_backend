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
import { BrandsService } from './brands.service';
import { SaveBrandDto } from './dto/save-brand.dto';

@Controller('brands')
@UseGuards(PermissionsGuard)
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @RequirePermissions('brand.view', 'brand.create')
  findAll(@CurrentUser() user: AccessPayload) {
    return this.brands.findAll(user.businessId as number);
  }

  @Get('dropdown')
  @RequirePermissions('brand.view', 'brand.create', 'brand.update')
  dropdown(@CurrentUser() user: AccessPayload) {
    return this.brands.forDropdown(user.businessId as number);
  }

  @Get(':id')
  @RequirePermissions('brand.view', 'brand.update')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.brands.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('brand.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveBrandDto) {
    return this.brands.create(user.businessId as number, user.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('brand.update')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveBrandDto,
  ) {
    return this.brands.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('brand.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.brands.remove(user.businessId as number, id);
  }
}
