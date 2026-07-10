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
import { PaginationQueryDto } from '../../common/dto/pagination.query';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';

@Controller('roles')
@UseGuards(PermissionsGuard)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('roles.view')
  findAll(@CurrentUser() user: AccessPayload, @Query() query: PaginationQueryDto) {
    return this.roles.findAll(user.businessId as number, query);
  }

  @Get(':id')
  @RequirePermissions('roles.update')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.roles.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('roles.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: CreateRoleDto) {
    return this.roles.create(user.businessId as number, dto);
  }

  @Patch(':id')
  @RequirePermissions('roles.update')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.roles.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('roles.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.roles.remove(user.businessId as number, id);
  }
}
