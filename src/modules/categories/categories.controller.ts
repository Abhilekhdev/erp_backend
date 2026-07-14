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
import { CategoriesService } from './categories.service';
import { SaveCategoryDto } from './dto/save-category.dto';

@Controller('categories')
@UseGuards(PermissionsGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermissions('category.view', 'category.create')
  findAll(@CurrentUser() user: AccessPayload) {
    return this.categories.findAll(user.businessId as number);
  }

  // Must precede ':id' so "dropdown" is not captured as an id.
  @Get('dropdown')
  @RequirePermissions('category.view', 'category.create', 'category.update')
  dropdown(@CurrentUser() user: AccessPayload) {
    return this.categories.forDropdown(user.businessId as number);
  }

  @Get(':id')
  @RequirePermissions('category.view', 'category.update')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.categories.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('category.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveCategoryDto) {
    return this.categories.create(user.businessId as number, user.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('category.update')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveCategoryDto,
  ) {
    return this.categories.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('category.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.categories.remove(user.businessId as number, id);
  }
}
