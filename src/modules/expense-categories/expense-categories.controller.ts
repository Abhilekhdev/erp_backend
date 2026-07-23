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
import { SaveExpenseCategoryDto } from './dto/save-expense-category.dto';
import { ExpenseCategoriesService } from './expense-categories.service';

@Controller('expense-categories')
@UseGuards(PermissionsGuard)
export class ExpenseCategoriesController {
  constructor(private readonly categories: ExpenseCategoriesService) {}

  @Get()
  @RequirePermissions('all_expense.access', 'view_own_expense')
  findAll(@CurrentUser() user: AccessPayload) {
    return this.categories.findAll(user.businessId as number);
  }

  @Get('dropdown')
  @RequirePermissions('all_expense.access', 'view_own_expense', 'expense.add', 'expense.edit')
  dropdown(@CurrentUser() user: AccessPayload) {
    return this.categories.forDropdown(user.businessId as number);
  }

  @Get(':id/sub-categories')
  @RequirePermissions('all_expense.access', 'view_own_expense', 'expense.add', 'expense.edit')
  subCategories(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.categories.subCategories(user.businessId as number, id);
  }

  @Get(':id')
  @RequirePermissions('all_expense.access', 'view_own_expense')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.categories.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('expense.add')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveExpenseCategoryDto) {
    return this.categories.create(user.businessId as number, dto);
  }

  @Patch(':id')
  @RequirePermissions('expense.edit')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveExpenseCategoryDto,
  ) {
    return this.categories.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('expense.delete')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.categories.remove(user.businessId as number, id);
  }
}
