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
import { AllowanceDeductionsService } from './allowance-deductions.service';
import {
  CreateAllowanceDeductionDto,
  UpdateAllowanceDeductionDto,
} from './dto/allowance-deduction.dto';

@Controller('hrm/pay-components')
@UseGuards(PermissionsGuard)
export class AllowanceDeductionsController {
  constructor(private readonly payComponents: AllowanceDeductionsService) {}

  @Get()
  @RequirePermissions('essentials.view_allowance_and_deduction', 'essentials.add_allowance_and_deduction')
  findAll(@CurrentUser() user: AccessPayload, @Query() query: PaginationQueryDto) {
    return this.payComponents.findAll(user.businessId as number, query);
  }

  @Get(':id')
  @RequirePermissions('essentials.view_allowance_and_deduction', 'essentials.add_allowance_and_deduction')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.payComponents.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('essentials.add_allowance_and_deduction')
  create(@CurrentUser() user: AccessPayload, @Body() dto: CreateAllowanceDeductionDto) {
    return this.payComponents.create(user.businessId as number, dto);
  }

  @Patch(':id')
  @RequirePermissions('essentials.add_allowance_and_deduction')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAllowanceDeductionDto,
  ) {
    return this.payComponents.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('essentials.add_allowance_and_deduction')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.payComponents.remove(user.businessId as number, id);
  }
}
