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
import { SaveInvoiceSchemeDto } from './dto/save-invoice-scheme.dto';
import { InvoiceSchemesService } from './invoice-schemes.service';

@Controller('invoice-schemes')
@UseGuards(PermissionsGuard)
export class InvoiceSchemesController {
  constructor(private readonly schemes: InvoiceSchemesService) {}

  @Get()
  @RequirePermissions('invoice_settings.access')
  findAll(@CurrentUser() user: AccessPayload) {
    return this.schemes.findAll(user.businessId as number);
  }

  @Get(':id')
  @RequirePermissions('invoice_settings.access')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.schemes.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('invoice_settings.access')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveInvoiceSchemeDto) {
    return this.schemes.create(user.businessId as number, dto);
  }

  @Patch(':id')
  @RequirePermissions('invoice_settings.access')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveInvoiceSchemeDto,
  ) {
    return this.schemes.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('invoice_settings.access')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.schemes.remove(user.businessId as number, id);
  }

  @Post(':id/set-default')
  @RequirePermissions('invoice_settings.access')
  @HttpCode(200)
  setDefault(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.schemes.setDefault(user.businessId as number, id);
  }
}
