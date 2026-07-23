import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { AccountTypesService } from './account-types.service';
import { SaveAccountTypeDto } from './dto/accounts.dto';

@Controller('account-types')
@UseGuards(PermissionsGuard)
export class AccountTypesController {
  constructor(private readonly types: AccountTypesService) {}

  @Get()
  @RequirePermissions('account.access')
  list(@CurrentUser() user: AccessPayload) {
    return this.types.findAll(user.businessId as number);
  }

  @Get('grouped')
  @RequirePermissions('account.access')
  grouped(@CurrentUser() user: AccessPayload) {
    return this.types.grouped(user.businessId as number);
  }

  @Post()
  @RequirePermissions('account.access')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveAccountTypeDto) {
    return this.types.create(user.businessId as number, dto);
  }

  @Put(':id')
  @RequirePermissions('account.access')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveAccountTypeDto,
  ) {
    return this.types.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('account.access')
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.types.remove(user.businessId as number, id);
  }
}
