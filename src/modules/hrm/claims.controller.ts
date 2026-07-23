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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { UploadedFileLike } from '../../common/services/storage.service';
import type { AccessPayload } from '../auth/token.service';
import { ClaimsService } from './claims.service';
import { ChangeClaimStatusDto, SaveClaimDto } from './dto/claim.dto';
import { ClaimsQueryDto } from './dto/claims-query.dto';

const CLAIM_ACCESS = ['essentials.view_claim_reimbursement', 'essentials.add_claim_reimbursement'] as const;
const CLAIM_ADD = ['essentials.add_claim_reimbursement'] as const;

@Controller('hrm/claims')
@UseGuards(PermissionsGuard)
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get()
  @RequirePermissions(...CLAIM_ACCESS)
  findAll(@CurrentUser() user: AccessPayload, @Query() query: ClaimsQueryDto) {
    return this.claims.findAll(user.businessId as number, query, user);
  }

  @Get('meta')
  @RequirePermissions(...CLAIM_ACCESS)
  meta(@CurrentUser() user: AccessPayload) {
    return this.claims.meta(user.businessId as number, user);
  }

  @Get('sub-categories/:parentId')
  @RequirePermissions(...CLAIM_ACCESS)
  subCategories(
    @CurrentUser() user: AccessPayload,
    @Param('parentId', ParseIntPipe) parentId: number,
  ) {
    return this.claims.subCategories(user.businessId as number, parentId);
  }

  @Get(':id')
  @RequirePermissions(...CLAIM_ACCESS)
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.claims.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions(...CLAIM_ADD)
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('document'))
  create(
    @CurrentUser() user: AccessPayload,
    @Body() dto: SaveClaimDto,
    @UploadedFile() document?: UploadedFileLike,
  ) {
    return this.claims.create(user.businessId as number, user, dto, document);
  }

  @Patch(':id')
  @RequirePermissions(...CLAIM_ADD)
  @UseInterceptors(FileInterceptor('document'))
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveClaimDto,
    @UploadedFile() document?: UploadedFileLike,
  ) {
    return this.claims.update(user.businessId as number, user, id, dto, document);
  }

  // Change-status is gated on view/add (not approve) at the route so a claimant's manager can act;
  // the service enforces the real "approver OR manager" rule.
  @Post(':id/status')
  @RequirePermissions(...CLAIM_ACCESS)
  @HttpCode(200)
  changeStatus(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeClaimStatusDto,
  ) {
    return this.claims.changeStatus(user.businessId as number, id, user, dto);
  }

  @Delete(':id')
  @RequirePermissions(...CLAIM_ADD)
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.claims.remove(user.businessId as number, id);
  }
}
