import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { ContactsService } from './contacts.service';
import { ContactsImportService } from './import/contacts-import.service';
import { ListContactsQueryDto } from './dto/list-contacts.query';
import { SaveContactDto } from './dto/save-contact.dto';

const VIEW = ['supplier.view', 'supplier.view_own', 'customer.view', 'customer.view_own'] as const;
const CREATE = ['supplier.create', 'customer.create'] as const;
const UPDATE = ['supplier.update', 'customer.update'] as const;
const DELETE = ['supplier.delete', 'customer.delete'] as const;

@Controller('contacts')
@UseGuards(PermissionsGuard)
export class ContactsController {
  constructor(
    private readonly contacts: ContactsService,
    private readonly imports: ContactsImportService,
  ) {}

  @Get()
  @RequirePermissions(...VIEW)
  findAll(@CurrentUser() user: AccessPayload, @Query() query: ListContactsQueryDto) {
    return this.contacts.findAll(user.businessId as number, query);
  }

  // ── import ───────────────────────────────────────────
  // GOURI gates both import routes on `supplier.create` OR `customer.create`
  // (ContactController.php:997) — an OR, so it never re-checks the permission against each row's type.

  /** The column spec, so the instructions table on screen can never drift from the parser. */
  @Get('import/columns')
  @RequirePermissions(...CREATE)
  importColumns() {
    return { data: this.imports.columns() };
  }

  /** Generated on the fly — there is no template file checked into the repo to go stale. */
  @Get('import/template')
  @RequirePermissions(...CREATE)
  @Header('Cache-Control', 'no-store')
  async importTemplate(@Query('format') format: string, @Res() res: Response) {
    const fmt = format === 'csv' ? 'csv' : 'xlsx';
    const buffer = await this.imports.buildTemplate(fmt);
    res.set({
      'Content-Type':
        fmt === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="import_contacts_template.${fmt}"`,
    });
    res.end(buffer);
  }

  /**
   * `dryRun=true` returns the same report without writing — the preview step GOURI has no equivalent
   * of. It is deliberately stateless: the file is re-sent on confirm rather than parked on the
   * server, so an abandoned preview leaves nothing behind to clean up.
   */
  @Post('import')
  @RequirePermissions(...CREATE)
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file')) // memory storage — the upload never touches disk
  importContacts(
    @CurrentUser() user: AccessPayload,
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRun?: string,
  ) {
    return this.imports.import(user.businessId as number, user.sub, file, dryRun === 'true');
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
