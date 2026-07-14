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
import { SaveTaxGroupDto } from './dto/save-tax-rate.dto';
import { TaxRatesService } from './tax-rates.service';

@Controller('tax-groups')
@UseGuards(PermissionsGuard)
export class TaxGroupsController {
  constructor(private readonly taxes: TaxRatesService) {}

  @Get(':id')
  @RequirePermissions('tax_rate.view', 'tax_rate.update')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.taxes.getGroup(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('tax_rate.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveTaxGroupDto) {
    return this.taxes.createGroup(user.businessId as number, user.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('tax_rate.update')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveTaxGroupDto,
  ) {
    return this.taxes.updateGroup(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('tax_rate.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.taxes.remove(user.businessId as number, id);
  }
}
