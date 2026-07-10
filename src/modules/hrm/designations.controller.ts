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
import { DesignationsService } from './designations.service';
import { CreateOrgItemDto, UpdateOrgItemDto } from './dto/org-item.dto';

@Controller('hrm/designations')
@UseGuards(PermissionsGuard)
export class DesignationsController {
  constructor(private readonly designations: DesignationsService) {}

  @Get()
  @RequirePermissions('essentials.crud_designation')
  findAll(@CurrentUser() user: AccessPayload, @Query() query: PaginationQueryDto) {
    return this.designations.findAll(user.businessId as number, query);
  }

  @Get(':id')
  @RequirePermissions('essentials.crud_designation')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.designations.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('essentials.crud_designation')
  create(@CurrentUser() user: AccessPayload, @Body() dto: CreateOrgItemDto) {
    return this.designations.create(user.businessId as number, user.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('essentials.crud_designation')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrgItemDto,
  ) {
    return this.designations.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('essentials.crud_designation')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.designations.remove(user.businessId as number, id);
  }
}
