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
import { CustomerGroupsService } from './customer-groups.service';
import { SaveCustomerGroupDto } from './dto/save-customer-group.dto';

@Controller('customer-groups')
@UseGuards(PermissionsGuard)
export class CustomerGroupsController {
  constructor(private readonly groups: CustomerGroupsService) {}

  @Get()
  @RequirePermissions('customer.view')
  findAll(@CurrentUser() user: AccessPayload) {
    return this.groups.findAll(user.businessId as number);
  }

  // Must precede ':id' so "dropdown" is not captured as an id.
  @Get('dropdown')
  @RequirePermissions('customer.view', 'customer.create', 'customer.update')
  dropdown(@CurrentUser() user: AccessPayload) {
    return this.groups.forDropdown(user.businessId as number);
  }

  @Get(':id')
  @RequirePermissions('customer.view')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.groups.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('customer.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveCustomerGroupDto) {
    return this.groups.create(user.businessId as number, user.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('customer.update')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveCustomerGroupDto,
  ) {
    return this.groups.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('customer.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.groups.remove(user.businessId as number, id);
  }
}
