import { Global, Module } from '@nestjs/common';
import { AbilityService } from './services/ability.service';

/**
 * Global home for cross-cutting authorization helpers. Exporting AbilityService globally lets both
 * the PermissionsGuard (instantiated per feature-module) and any feature service inject the same
 * permission-resolution logic.
 */
@Global()
@Module({
  providers: [AbilityService],
  exports: [AbilityService],
})
export class CommonModule {}
