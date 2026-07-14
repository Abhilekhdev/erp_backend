import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';

import { validateEnv, type Env } from './config/env.validation';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { PrismaModule } from './infra/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { BusinessLocationsModule } from './modules/business-locations/business-locations.module';
import { BrandsModule } from './modules/brands/brands.module';
import { BusinessSettingsModule } from './modules/business-settings/business-settings.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { CommissionAgentsModule } from './modules/commission-agents/commission-agents.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { CustomerGroupsModule } from './modules/customer-groups/customer-groups.module';
import { HealthModule } from './modules/health/health.module';
import { HrmModule } from './modules/hrm/hrm.module';
import { InvoiceSchemesModule } from './modules/invoice-schemes/invoice-schemes.module';
import { NotificationTemplatesModule } from './modules/notification-templates/notification-templates.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { ProductsModule } from './modules/products/products.module';
import { RolesModule } from './modules/roles/roles.module';
import { SellingPriceGroupsModule } from './modules/selling-price-groups/selling-price-groups.module';
import { TaxRatesModule } from './modules/tax-rates/tax-rates.module';
import { UnitsModule } from './modules/units/units.module';
import { VariationTemplatesModule } from './modules/variation-templates/variation-templates.module';
import { WarrantiesModule } from './modules/warranties/warranties.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: '.env',
      validate: validateEnv,
    }),
    // Request-scoped context store — will carry businessId/userId for tenant scoping.
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        {
          ttl: config.get('THROTTLE_TTL', { infer: true }) * 1000,
          limit: config.get('THROTTLE_LIMIT', { infer: true }),
        },
      ],
    }),
    PrismaModule,
    CommonModule,
    AuthModule,
    PermissionsModule,
    RolesModule,
    UsersModule,
    CommissionAgentsModule,
    ContactsModule,
    CustomerGroupsModule,
    BusinessSettingsModule,
    BusinessLocationsModule,
    InvoiceSchemesModule,
    NotificationTemplatesModule,
    HrmModule,
    UnitsModule,
    CategoriesModule,
    BrandsModule,
    TaxRatesModule,
    VariationTemplatesModule,
    WarrantiesModule,
    SellingPriceGroupsModule,
    ProductsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
