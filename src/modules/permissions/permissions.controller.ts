import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AccessPayload } from '../auth/token.service';
import { PermissionsService } from './permissions.service';

@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  /** Grouped permission catalogue for the caller's business, module-filtered (auth required). */
  @Get('catalog')
  catalog(@CurrentUser() user: AccessPayload) {

    // console.log('PermissionsController.catalog user:', user);
    // console.log('PermissionsController.catalog user.businessId:', this.permissions.getCatalog(user.businessId as number));
    return this.permissions.getCatalog(user.businessId as number);
  }
}
