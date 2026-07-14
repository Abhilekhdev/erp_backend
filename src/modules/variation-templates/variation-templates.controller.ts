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
import { SaveVariationTemplateDto } from './dto/save-variation-template.dto';
import { VariationTemplatesService } from './variation-templates.service';

// GOURI has no dedicated permission for variation templates — gate them with the product perms
// (they are part of product setup).
@Controller('variation-templates')
@UseGuards(PermissionsGuard)
export class VariationTemplatesController {
  constructor(private readonly templates: VariationTemplatesService) {}

  @Get()
  @RequirePermissions('product.view', 'product.create')
  findAll(@CurrentUser() user: AccessPayload) {
    return this.templates.findAll(user.businessId as number);
  }

  @Get('dropdown')
  @RequirePermissions('product.view', 'product.create', 'product.update')
  dropdown(@CurrentUser() user: AccessPayload) {
    return this.templates.forDropdown(user.businessId as number);
  }

  @Get(':id')
  @RequirePermissions('product.view', 'product.update')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.templates.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('product.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveVariationTemplateDto) {
    return this.templates.create(user.businessId as number, dto);
  }

  @Patch(':id')
  @RequirePermissions('product.update')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveVariationTemplateDto,
  ) {
    return this.templates.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('product.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.templates.remove(user.businessId as number, id);
  }
}
