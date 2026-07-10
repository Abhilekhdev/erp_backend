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
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(PermissionsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('user.view', 'user.create')
  findAll(@CurrentUser() user: AccessPayload, @Query() query: PaginationQueryDto) {
    return this.users.findAll(user.businessId as number, query);
  }

  // Must be declared before ':id' so "meta" is not captured as an id param.
  @Get('meta')
  @RequirePermissions('user.view', 'user.create', 'user.update')
  meta(@CurrentUser() user: AccessPayload) {
    return this.users.meta(user.businessId as number, user.isBusinessAdmin);
  }

  @Get(':id')
  @RequirePermissions('user.view', 'user.update')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.users.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('user.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: CreateUserDto) {
    return this.users.create(user.businessId as number, dto);
  }

  @Patch(':id')
  @RequirePermissions('user.update')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('user.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.users.remove(user.businessId as number, id);
  }
}
