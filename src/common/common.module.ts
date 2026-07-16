import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { AbilityService } from './services/ability.service';
import { MailService } from './services/mail.service';
import { ReferenceNumberService } from './services/reference-number.service';

/**
 * Global home for cross-cutting authorization helpers. Exporting AbilityService globally lets both
 * the PermissionsGuard (instantiated per feature-module) and any feature service inject the same
 * permission-resolution logic. AuditService is global for the same reason: any module may need to
 * record a semantic event (login, status change) that a raw DB write cannot imply on its own.
 */
@Global()
@Module({
  providers: [AbilityService, AuditService, ReferenceNumberService, MailService],
  exports: [AbilityService, AuditService, ReferenceNumberService, MailService],
})
export class CommonModule {}
