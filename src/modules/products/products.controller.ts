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
import { ProductsQueryDto } from './dto/products-query.dto';
import { SaveProductDto } from './dto/save-product.dto';
import { ProductsService } from './products.service';

@Controller('products')
@UseGuards(PermissionsGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get('meta')
  @RequirePermissions('product.view', 'product.create')
  meta(@CurrentUser() user: AccessPayload) {
    return this.products.meta(user.businessId as number);
  }

  // Component picker for combo products. Must precede ':id'.
  @Get('variations')
  @RequirePermissions('product.view', 'product.create')
  variations(@CurrentUser() user: AccessPayload, @Query('search') search?: string) {
    return this.products.variationsForCombo(user.businessId as number, search ?? '');
  }

  @Get()
  @RequirePermissions('product.view', 'product.create')
  list(@CurrentUser() user: AccessPayload, @Query() query: ProductsQueryDto) {
    return this.products.list(user.businessId as number, query);
  }

  @Get(':id')
  @RequirePermissions('product.view', 'product.update')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.products.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('product.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveProductDto) {
    return this.products.create(user.businessId as number, user.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('product.update')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveProductDto,
  ) {
    return this.products.update(user.businessId as number, id, dto);
  }

  @Post(':id/toggle-active')
  @RequirePermissions('product.update')
  toggleActive(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body('isActive') isActive: boolean,
  ) {
    return this.products.setActive(user.businessId as number, id, Boolean(isActive));
  }

  @Delete(':id')
  @RequirePermissions('product.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.products.remove(user.businessId as number, id);
  }
}
