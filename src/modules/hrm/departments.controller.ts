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
import { DepartmentsService } from './departments.service';
import { CreateOrgItemDto, UpdateOrgItemDto } from './dto/org-item.dto';

@Controller('hrm/departments')
@UseGuards(PermissionsGuard)
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @RequirePermissions('essentials.crud_department')
  findAll(@CurrentUser() user: AccessPayload, @Query() query: PaginationQueryDto) {
    return this.departments.findAll(user.businessId as number, query);
  }

  @Get(':id')
  @RequirePermissions('essentials.crud_department')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.departments.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('essentials.crud_department')
  create(@CurrentUser() user: AccessPayload, @Body() dto: CreateOrgItemDto) {
    return this.departments.create(user.businessId as number, user.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('essentials.crud_department')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrgItemDto,
  ) {
    return this.departments.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('essentials.crud_department')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.departments.remove(user.businessId as number, id);
  }
}
