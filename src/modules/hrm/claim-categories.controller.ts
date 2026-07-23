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
import { ClaimCategoriesService } from './claim-categories.service';
import { SaveClaimCategoryDto } from './dto/claim.dto';
import { ClaimCategoriesQueryDto } from './dto/claims-query.dto';

const CATEGORY_VIEW = ['essentials.claim_reimbursement_category'] as const;
const CATEGORY_ADD = ['essentials.add_claim_reimbursement_category'] as const;

@Controller('hrm/claim-categories')
@UseGuards(PermissionsGuard)
export class ClaimCategoriesController {
  constructor(private readonly categories: ClaimCategoriesService) {}

  @Get()
  @RequirePermissions(...CATEGORY_VIEW)
  findAll(@CurrentUser() user: AccessPayload, @Query() query: ClaimCategoriesQueryDto) {
    return this.categories.findAll(user.businessId as number, query);
  }

  @Get('parents')
  @RequirePermissions(...CATEGORY_ADD)
  parents(@CurrentUser() user: AccessPayload) {
    return this.categories.parents(user.businessId as number);
  }

  @Get(':id')
  @RequirePermissions(...CATEGORY_VIEW)
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.categories.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions(...CATEGORY_ADD)
  @HttpCode(200)
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveClaimCategoryDto) {
    return this.categories.create(user.businessId as number, dto);
  }

  @Patch(':id')
  @RequirePermissions(...CATEGORY_ADD)
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveClaimCategoryDto,
  ) {
    return this.categories.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(...CATEGORY_ADD)
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.categories.remove(user.businessId as number, id);
  }
}
