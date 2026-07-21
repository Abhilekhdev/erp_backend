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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { MassActionDto, MassActivateDto, MassLocationsDto } from './dto/mass-action.dto';
import { ProductsQueryDto } from './dto/products-query.dto';
import { SaveProductDto } from './dto/save-product.dto';
import { ProductsService, type UploadedImage } from './products.service';

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
    // The whole user, not just the tenant: the price columns are permission-gated per caller.
    return this.products.list(user, query);
  }

  /** The current filter set as a spreadsheet. Declared before ':id' so it isn't read as an id. */
  @Get('export')
  @RequirePermissions('product.view', 'product.create')
  async exportExcel(
    @CurrentUser() user: AccessPayload,
    @Query() query: ProductsQueryDto,
    @Res() res: Response,
  ) {
    const buffer = await this.products.exportExcel(user, query);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="products-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      'Cache-Control': 'no-store',
    });
    res.end(buffer);
  }

  // ── mass actions ─────────────────────────────────────
  @Post('mass-delete')
  @RequirePermissions('product.delete')
  @HttpCode(200)
  massDelete(@CurrentUser() user: AccessPayload, @Body() dto: MassActionDto) {
    return this.products.massDelete(user.businessId as number, dto.ids);
  }

  @Post('mass-activate')
  @RequirePermissions('product.update')
  @HttpCode(200)
  massActivate(@CurrentUser() user: AccessPayload, @Body() dto: MassActivateDto) {
    return this.products.massSetActive(user.businessId as number, dto.ids, dto.active);
  }

  @Post('mass-locations')
  @RequirePermissions('product.update')
  @HttpCode(200)
  massLocations(@CurrentUser() user: AccessPayload, @Body() dto: MassLocationsDto) {
    return this.products.massUpdateLocations(user.businessId as number, dto.ids, dto.location_ids, dto.mode);
  }

  /** Upload first, then send the returned `path` as the product's `image`. */
  @Post('image')
  @RequirePermissions('product.create', 'product.update')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(@CurrentUser() user: AccessPayload, @UploadedFile() file: UploadedImage) {
    return this.products.uploadImage(user.businessId as number, file);
  }

  // ── attachments (brochure / variation images) ────────
  @Get(':id/media')
  @RequirePermissions('product.view', 'product.update')
  listMedia(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.products.listMedia(user.businessId as number, id);
  }

  @Post(':id/media')
  @RequirePermissions('product.create', 'product.update')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  uploadMedia(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body('kind') kind: string,
    @UploadedFile() file: UploadedImage,
  ) {
    const type = kind === 'variation_image' ? 'variation_image' : 'product_brochure';
    return this.products.uploadMedia(user.businessId as number, user.sub, id, type, file);
  }

  @Delete('media/:mediaId')
  @RequirePermissions('product.update')
  @HttpCode(200)
  removeMedia(@CurrentUser() user: AccessPayload, @Param('mediaId', ParseIntPipe) mediaId: number) {
    return this.products.removeMedia(user.businessId as number, mediaId);
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
