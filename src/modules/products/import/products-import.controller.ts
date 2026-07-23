import {
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import type { AccessPayload } from '../../auth/token.service';
import { OpeningStockImportService } from './opening-stock-import.service';
import { ProductsImportService } from './products-import.service';

@Controller('products/import')
@UseGuards(PermissionsGuard)
export class ProductsImportController {
  constructor(
    private readonly productsImport: ProductsImportService,
    private readonly openingStockImport: OpeningStockImportService,
  ) {}

  // ── products ─────────────────────────────────────────
  @Get('columns')
  @RequirePermissions('product.create')
  columns() {
    return { data: this.productsImport.columns() };
  }

  @Get('template')
  @RequirePermissions('product.create')
  @Header('Cache-Control', 'no-store')
  async template(@Query('format') format: string, @Res() res: Response) {
    const fmt = format === 'csv' ? 'csv' : 'xlsx';
    const buffer = await this.productsImport.buildTemplate(fmt);
    res.set({
      'Content-Type': fmt === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="import_products_template.${fmt}"`,
    });
    res.end(buffer);
  }

  @Post()
  @RequirePermissions('product.create')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  import(@CurrentUser() user: AccessPayload, @UploadedFile() file: Express.Multer.File, @Query('dryRun') dryRun?: string) {
    return this.productsImport.import(user.businessId as number, user.sub, file, dryRun === 'true');
  }

  // ── opening stock ────────────────────────────────────
  @Get('opening-stock/columns')
  @RequirePermissions('product.opening_stock')
  openingStockColumns() {
    return { data: this.openingStockImport.columns() };
  }

  @Get('opening-stock/template')
  @RequirePermissions('product.opening_stock')
  @Header('Cache-Control', 'no-store')
  async openingStockTemplate(@Query('format') format: string, @Res() res: Response) {
    const fmt = format === 'csv' ? 'csv' : 'xlsx';
    const buffer = await this.openingStockImport.buildTemplate(fmt);
    res.set({
      'Content-Type': fmt === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="import_opening_stock_template.${fmt}"`,
    });
    res.end(buffer);
  }

  @Post('opening-stock')
  @RequirePermissions('product.opening_stock')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  importOpeningStock(@CurrentUser() user: AccessPayload, @UploadedFile() file: Express.Multer.File, @Query('dryRun') dryRun?: string) {
    return this.openingStockImport.import(user.businessId as number, user.sub, file, dryRun === 'true');
  }
}
