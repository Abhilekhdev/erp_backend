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
import { CommissionAgentsService } from './commission-agents.service';
import { CreateCommissionAgentDto, UpdateCommissionAgentDto } from './dto/commission-agent.dto';

@Controller('commission-agents')
@UseGuards(PermissionsGuard)
export class CommissionAgentsController {
  constructor(private readonly agents: CommissionAgentsService) {}

  @Get()
  @RequirePermissions('user.view', 'user.create')
  findAll(@CurrentUser() user: AccessPayload, @Query() query: PaginationQueryDto) {
    return this.agents.findAll(user.businessId as number, query);
  }

  @Get(':id')
  @RequirePermissions('user.view', 'user.update')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.agents.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('user.create')
  create(@CurrentUser() user: AccessPayload, @Body() dto: CreateCommissionAgentDto) {
    return this.agents.create(user.businessId as number, dto);
  }

  @Patch(':id')
  @RequirePermissions('user.update')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCommissionAgentDto,
  ) {
    return this.agents.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('user.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.agents.remove(user.businessId as number, id);
  }
}
