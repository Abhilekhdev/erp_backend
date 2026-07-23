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
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { ExpensesQueryDto, SaveExpenseDto, UpdateExpenseDto } from './dto/save-expense.dto';
import { ExpensesService } from './expenses.service';

@Controller('expenses')
@UseGuards(PermissionsGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @RequirePermissions('all_expense.access', 'view_own_expense')
  findAll(@CurrentUser() user: AccessPayload, @Query() query: ExpensesQueryDto) {
    return this.expenses.findAll(user, query);
  }

  // Before ':id' so "meta" isn't captured as an id.
  @Get('meta')
  @RequirePermissions('all_expense.access', 'view_own_expense', 'expense.add', 'expense.edit')
  meta(@CurrentUser() user: AccessPayload) {
    return this.expenses.meta(user.businessId as number);
  }

  @Get(':id')
  @RequirePermissions('all_expense.access', 'view_own_expense')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.expenses.findOne(user, id);
  }

  @Post()
  @RequirePermissions('expense.add')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveExpenseDto) {
    return this.expenses.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('expense.edit')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expenses.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('expense.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.expenses.remove(user, id);
  }
}
