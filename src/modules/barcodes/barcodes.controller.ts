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
import { BarcodesService } from './barcodes.service';
import { SaveBarcodeDto } from './dto/save-barcode.dto';

/**
 * Label-sheet layouts (GOURI `/barcodes`). Print Labels needs one to know the sticker geometry, so
 * reading is open to anyone who can print labels; only editing requires `barcode_settings.access`.
 */
@Controller('barcodes')
@UseGuards(PermissionsGuard)
export class BarcodesController {
  constructor(private readonly barcodes: BarcodesService) {}

  @Get()
  @RequirePermissions('barcode_settings.access', 'product.view', 'product.create')
  findAll(@CurrentUser() user: AccessPayload) {
    return this.barcodes.findAll(user.businessId as number);
  }

  @Get('default')
  @RequirePermissions('barcode_settings.access', 'product.view', 'product.create')
  defaultSheet(@CurrentUser() user: AccessPayload) {
    return this.barcodes.defaultSheet(user.businessId as number);
  }

  @Get(':id')
  @RequirePermissions('barcode_settings.access')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.barcodes.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('barcode_settings.access')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveBarcodeDto) {
    return this.barcodes.create(user.businessId as number, dto);
  }

  @Patch(':id')
  @RequirePermissions('barcode_settings.access')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveBarcodeDto,
  ) {
    return this.barcodes.update(user.businessId as number, id, dto);
  }

  @Post(':id/set-default')
  @RequirePermissions('barcode_settings.access')
  @HttpCode(200)
  setDefault(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.barcodes.setDefault(user.businessId as number, id);
  }

  @Delete(':id')
  @RequirePermissions('barcode_settings.access')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.barcodes.remove(user.businessId as number, id);
  }
}
