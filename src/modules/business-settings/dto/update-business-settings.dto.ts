import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  AccountingMethod,
  CurrencySymbolPlacement,
  ExpiryType,
  OnProductExpiry,
  RewardPointExpiryType,
  SalesCommissionAgentSetting,
  SellPriceTax,
  TimeFormat,
} from '@prisma/client';

/**
 * Business Settings update payload — the full 16-tab form (Laravel `postBusinessSettings`).
 * Scalar/enum fields map 1:1 to `business` columns; the JSON blobs persist verbatim into the
 * jsonb columns (`pos_settings`, `common_settings`, …) exactly like Laravel's `json_encode`.
 * Enum VALUES use the Prisma names (e.g. FIFO/H24); Prisma @map writes the legacy db value (fifo/24).
 */

/** Free-form settings blob — persisted as-is, mirrors Laravel storing raw arrays as JSON. */
const jsonBlob = z.record(z.string(), z.unknown());

export const updateBusinessSettingsSchema = z.object({
  // ---- Business tab (columns) ----
  name: z.string().min(1, 'Business name is required').max(255),
  startDate: z.coerce.date().nullish(),
  defaultProfitPercent: z.coerce.number().optional(),
  currencyId: z.coerce.number().int(),
  currencySymbolPlacement: z.nativeEnum(CurrencySymbolPlacement).optional(),
  timeZone: z.string().max(255).optional(),
  fyStartMonth: z.coerce.number().int().min(1).max(12).optional(),
  accountingMethod: z.nativeEnum(AccountingMethod).optional(),
  transactionEditDays: z.coerce.number().int().min(0),
  dateFormat: z.string().max(255).optional(),
  timeFormat: z.nativeEnum(TimeFormat).optional(),
  currencyPrecision: z.coerce.number().int().min(0).max(4).optional(),
  quantityPrecision: z.coerce.number().int().min(0).max(4).optional(),
  codeLabel1: z.string().max(255).nullish(),
  code1: z.string().max(255).nullish(),
  codeLabel2: z.string().max(255).nullish(),
  code2: z.string().max(255).nullish(),

  // ---- Tax tab (columns) ----
  taxLabel1: z.string().max(10).nullish(),
  taxNumber1: z.string().max(100).nullish(),
  taxLabel2: z.string().max(10).nullish(),
  taxNumber2: z.string().max(100).nullish(),
  enableInlineTax: z.boolean().optional(),

  // ---- Product tab (columns) ----
  skuPrefix: z.string().max(255).nullish(),
  enableProductExpiry: z.boolean().optional(),
  expiryType: z.nativeEnum(ExpiryType).optional(),
  onProductExpiry: z.nativeEnum(OnProductExpiry).optional(),
  stopSellingBefore: z.coerce.number().int().nullish(),
  enableBrand: z.boolean().optional(),
  enableCategory: z.boolean().optional(),
  enableSubCategory: z.boolean().optional(),
  enablePriceTax: z.boolean().optional(),
  defaultUnit: z.coerce.number().int().nullish(),
  enableSubUnits: z.boolean().optional(),
  enableRacks: z.boolean().optional(),
  enableRow: z.boolean().optional(),
  enablePosition: z.boolean().optional(),

  // ---- Sale tab (columns) ----
  defaultSalesDiscount: z.coerce.number().nullish(),
  defaultSalesTax: z.coerce.number().int().nullish(),
  sellPriceTax: z.nativeEnum(SellPriceTax).optional(),
  itemAdditionMethod: z.boolean().optional(),
  salesCmsnAgnt: z.nativeEnum(SalesCommissionAgentSetting).nullish(),

  // ---- Purchases tab (columns) ----
  purchaseInDiffCurrency: z.boolean().optional(),
  purchaseCurrencyId: z.coerce.number().int().nullish(),
  pExchangeRate: z.coerce.number().optional(),
  enableEditingProductFromPurchase: z.boolean().optional(),
  enablePurchaseStatus: z.boolean().optional(),
  enableLotNumber: z.boolean().optional(),

  // ---- Dashboard tab (column) ----
  stockExpiryAlertDays: z.coerce.number().int().min(0),

  // ---- System tab (columns) ----
  themeColor: z.string().max(20).nullish(),
  enableTooltip: z.boolean().optional(),

  // ---- Reward Point tab (columns) ----
  enableRp: z.boolean().optional(),
  rpName: z.string().max(255).nullish(),
  amountForUnitRp: z.coerce.number().optional(),
  minOrderTotalForRp: z.coerce.number().optional(),
  maxRpPerOrder: z.coerce.number().int().nullish(),
  redeemAmountPerUnitRp: z.coerce.number().optional(),
  minOrderTotalForRedeem: z.coerce.number().optional(),
  minRedeemPoint: z.coerce.number().int().nullish(),
  maxRedeemPoint: z.coerce.number().int().nullish(),
  rpExpiryPeriod: z.coerce.number().int().nullish(),
  rpExpiryType: z.nativeEnum(RewardPointExpiryType).optional(),

  // ---- JSON blob columns (persisted verbatim) ----
  posSettings: jsonBlob.optional(), // Sale + POS + Payment tabs
  commonSettings: jsonBlob.optional(), // Business/Product/Contact/Purchases/System extras
  refNoPrefixes: jsonBlob.optional(), // Prefixes tab
  customLabels: jsonBlob.optional(), // Custom Labels tab
  emailSettings: jsonBlob.optional(), // Email tab
  smsSettings: jsonBlob.optional(), // SMS tab
  weighingScaleSetting: jsonBlob.optional(), // POS tab (weighing scale)
  keyboardShortcuts: jsonBlob.optional(), // POS shortcuts
  enabledModules: z.array(z.string()).optional(), // Modules tab
});

export class UpdateBusinessSettingsDto extends createZodDto(updateBusinessSettingsSchema) {}
