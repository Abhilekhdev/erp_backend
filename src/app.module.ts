import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';

import { validateEnv, type Env } from './config/env.validation';
import { AuditContextInterceptor } from './common/audit/audit-context.interceptor';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { PrismaModule } from './infra/prisma/prisma.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { ActivityLogModule } from './modules/activity-log/activity-log.module';
import { AuthModule } from './modules/auth/auth.module';
import { BusinessLocationsModule } from './modules/business-locations/business-locations.module';
import { BarcodesModule } from './modules/barcodes/barcodes.module';
import { BrandsModule } from './modules/brands/brands.module';
import { BusinessSettingsModule } from './modules/business-settings/business-settings.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { CommissionAgentsModule } from './modules/commission-agents/commission-agents.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { CustomerGroupsModule } from './modules/customer-groups/customer-groups.module';
import { ExpenseCategoriesModule } from './modules/expense-categories/expense-categories.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { HealthModule } from './modules/health/health.module';
import { HrmModule } from './modules/hrm/hrm.module';
import { InvoiceSchemesModule } from './modules/invoice-schemes/invoice-schemes.module';
import { NotificationTemplatesModule } from './modules/notification-templates/notification-templates.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { ProductsModule } from './modules/products/products.module';
import { OpeningStockModule } from './modules/opening-stock/opening-stock.module';
import { SellsModule } from './modules/sells/sells.module';
import { SalesOrdersModule } from './modules/sales-orders/sales-orders.module';
import { SellReturnsModule } from './modules/sell-returns/sell-returns.module';
import { PurchaseOrdersModule } from './modules/purchase-orders/purchase-orders.module';
import { PurchaseRequisitionsModule } from './modules/purchase-requisitions/purchase-requisitions.module';
import { PurchaseReturnsModule } from './modules/purchase-returns/purchase-returns.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RolesModule } from './modules/roles/roles.module';
import { SellingPriceGroupsModule } from './modules/selling-price-groups/selling-price-groups.module';
import { StockAdjustmentsModule } from './modules/stock-adjustments/stock-adjustments.module';
import { StockTransfersModule } from './modules/stock-transfers/stock-transfers.module';
import { WastageTypesModule } from './modules/wastage-types/wastage-types.module';
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
    ExpenseCategoriesModule,
    ExpensesModule,
    BusinessSettingsModule,
    BusinessLocationsModule,
    InvoiceSchemesModule,
    NotificationTemplatesModule,
    NotificationsModule,
    CalendarModule,
    HrmModule,
    UnitsModule,
    CategoriesModule,
    BrandsModule,
    TaxRatesModule,
    VariationTemplatesModule,
    WarrantiesModule,
    SellingPriceGroupsModule,
    ProductsModule,
    BarcodesModule,
    PurchasesModule,
    PurchaseRequisitionsModule,
    PurchaseOrdersModule,
    PurchaseReturnsModule,
    OpeningStockModule,
    SellsModule,
    SalesOrdersModule,
    SellReturnsModule,
    AccountsModule,
    WastageTypesModule,
    StockAdjustmentsModule,
    StockTransfersModule,
    ReportsModule,
    ActivityLogModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Must precede any handler work: it lifts the JWT's causer/tenant into CLS so the Prisma
    // audit middleware knows who is behind each write.
    { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
