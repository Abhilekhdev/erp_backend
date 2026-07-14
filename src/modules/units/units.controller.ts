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
import { SaveUnitDto } from './dto/save-unit.dto';
import { UnitsService } from './units.service';

@Controller('units')
@UseGuards(PermissionsGuard)
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  @RequirePermissions('unit.view', 'unit.create')
  findAll(@CurrentUser() user: AccessPayload) {
    return this.units.findAll(user.businessId as number);
  }

  // Must precede ':id' so "dropdown" is not captured as an id.
  @Get('dropdown')
  @RequirePermissions('unit.view', 'unit.create', 'unit.update')
  dropdown(@CurrentUser() user: AccessPayload) {
    return this.units.forDropdown(user.businessId as number);
  }

  @Get(':id')
  @RequirePermissions('unit.view', 'unit.update')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.units.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('unit.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveUnitDto) {
    return this.units.create(user.businessId as number, user.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('unit.update')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveUnitDto,
  ) {
    return this.units.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('unit.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.units.remove(user.businessId as number, id);
  }
}
