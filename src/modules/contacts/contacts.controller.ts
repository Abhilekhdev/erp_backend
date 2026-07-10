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
import { ContactsService } from './contacts.service';
import { ListContactsQueryDto } from './dto/list-contacts.query';
import { SaveContactDto } from './dto/save-contact.dto';

const VIEW = ['supplier.view', 'supplier.view_own', 'customer.view', 'customer.view_own'] as const;
const CREATE = ['supplier.create', 'customer.create'] as const;
const UPDATE = ['supplier.update', 'customer.update'] as const;
const DELETE = ['supplier.delete', 'customer.delete'] as const;

@Controller('contacts')
@UseGuards(PermissionsGuard)
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequirePermissions(...VIEW)
  findAll(@CurrentUser() user: AccessPayload, @Query() query: ListContactsQueryDto) {
    return this.contacts.findAll(user.businessId as number, query);
  }

  // Declared before ':id' so these are not captured as an id param.
  @Get('meta')
  @RequirePermissions(...VIEW, ...CREATE)
  meta(@CurrentUser() user: AccessPayload) {
    return this.contacts.meta(user.businessId as number);
  }

  @Post('check-contact-id')
  @RequirePermissions(...CREATE, ...UPDATE)
  @HttpCode(200)
  checkContactId(
    @CurrentUser() user: AccessPayload,
    @Body() body: { contactId?: string; exceptId?: number },
  ) {
    return this.contacts.checkContactId(user.businessId as number, body.contactId ?? '', body.exceptId);
  }

  @Post('check-mobile')
  @RequirePermissions(...CREATE, ...UPDATE)
  @HttpCode(200)
  checkMobile(
    @CurrentUser() user: AccessPayload,
    @Body() body: { mobile: string; exceptId?: number },
  ) {
    return this.contacts.checkMobile(user.businessId as number, body.mobile, body.exceptId);
  }

  @Post('mass-delete')
  @RequirePermissions(...DELETE)
  @HttpCode(200)
  massDelete(@CurrentUser() user: AccessPayload, @Body() body: { ids: number[] }) {
    return this.contacts.massDestroy(user.businessId as number, body.ids ?? []);
  }

  @Get(':id')
  @RequirePermissions(...VIEW)
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.contacts.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions(...CREATE)
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveContactDto) {
    return this.contacts.create(user.businessId as number, user.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions(...UPDATE)
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveContactDto,
  ) {
    return this.contacts.update(user.businessId as number, id, dto);
  }

  @Patch(':id/toggle-status')
  @RequirePermissions(...UPDATE)
  toggleStatus(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.contacts.updateStatus(user.businessId as number, id);
  }

  @Delete(':id')
  @RequirePermissions(...DELETE)
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.contacts.remove(user.businessId as number, id);
  }
}
