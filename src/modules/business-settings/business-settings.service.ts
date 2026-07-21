import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorageService } from '../../common/services/storage.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  ACCOUNTING_METHODS,
  AMOUNT_ROUNDING_METHODS,
  AVAILABLE_MODULES,
  CASH_DENOMINATION_ON_OPTIONS,
  COMMISSION_CALCULATION_TYPES,
  CURRENCY_SYMBOL_PLACEMENTS,
  DATATABLE_PAGE_ENTRIES,
  DATE_FORMATS,
  EXPIRY_TYPES,
  ITEM_ADDITION_METHODS,
  MONTHS,
  ON_PRODUCT_EXPIRY_OPTIONS,
  POS_SHORTCUT_KEYS,
  PRECISIONS,
  RP_EXPIRY_TYPES,
  SALES_COMMISSION_AGENT_OPTIONS,
  SELL_PRICE_TAX_OPTIONS,
  THEME_COLORS,
  TIME_FORMATS,
  WEIGHING_SCALE_RANGES,
} from './business-settings.constants';
import type { UpdateBusinessSettingsDto } from './dto/update-business-settings.dto';

const ALLOWED_IMAGE = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
const LOGO_FIELDS = { logo: 'logo', login_logo: 'loginLogo' } as const;

/** Minimal shape of a multer memory-storage file — avoids a hard @types/multer dependency. */
export interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class BusinessSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** GET /business/settings — the tenant's business row + all dropdown option lists. */
  async getSettings(businessId: number) {
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException('Business not found');

    // Global (currencies) + tenant-scoped option data. TaxRate & Unit modules land later,
    // so those two lists are empty for now — the fields still persist fine.
    const currencies = await this.prisma.currency.findMany({
      orderBy: { country: 'asc' },
      select: { id: true, country: true, currency: true, code: true, symbol: true },
    });

    return {
      business,
      options: {
        currencies: currencies.map((c) => ({
          value: c.id,
          label: `${c.country} - ${c.currency} (${c.symbol})`,
        })),
        taxRates: [], // Tax Rates module — pending
        units: [], // Units module — pending
        accountingMethods: ACCOUNTING_METHODS,
        dateFormats: DATE_FORMATS,
        timeFormats: TIME_FORMATS,
        currencySymbolPlacements: CURRENCY_SYMBOL_PLACEMENTS,
        months: MONTHS,
        precisions: PRECISIONS,
        salesCommissionAgents: SALES_COMMISSION_AGENT_OPTIONS,
        itemAdditionMethods: ITEM_ADDITION_METHODS,
        expiryTypes: EXPIRY_TYPES,
        onProductExpiry: ON_PRODUCT_EXPIRY_OPTIONS,
        sellPriceTax: SELL_PRICE_TAX_OPTIONS,
        amountRoundingMethods: AMOUNT_ROUNDING_METHODS,
        commissionCalculationTypes: COMMISSION_CALCULATION_TYPES,
        cashDenominationOn: CASH_DENOMINATION_ON_OPTIONS,
        rpExpiryTypes: RP_EXPIRY_TYPES,
        themeColors: THEME_COLORS,
        datatablePageEntries: DATATABLE_PAGE_ENTRIES,
        availableModules: AVAILABLE_MODULES,
        weighingScaleRanges: WEIGHING_SCALE_RANGES,
        posShortcutKeys: POS_SHORTCUT_KEYS,
      },
    };
  }

  /** PUT /business/settings — persist the full 16-tab form (Laravel postBusinessSettings). */
  async updateSettings(businessId: number, dto: UpdateBusinessSettingsDto) {
    const exists = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Business not found');

    const asJson = (v: unknown): Prisma.InputJsonValue | undefined =>
      v === undefined ? undefined : (v as Prisma.InputJsonValue);

    const data: Prisma.BusinessUpdateInput = {
      name: dto.name,
      startDate: dto.startDate ?? null,
      defaultProfitPercent: dto.defaultProfitPercent,
      currency: { connect: { id: dto.currencyId } },
      currencySymbolPlacement: dto.currencySymbolPlacement,
      timeZone: dto.timeZone,
      fyStartMonth: dto.fyStartMonth,
      accountingMethod: dto.accountingMethod,
      transactionEditDays: dto.transactionEditDays,
      dateFormat: dto.dateFormat,
      timeFormat: dto.timeFormat,
      currencyPrecision: dto.currencyPrecision,
      quantityPrecision: dto.quantityPrecision,
      codeLabel1: dto.codeLabel1,
      code1: dto.code1,
      codeLabel2: dto.codeLabel2,
      code2: dto.code2,

      taxLabel1: dto.taxLabel1,
      taxNumber1: dto.taxNumber1,
      taxLabel2: dto.taxLabel2,
      taxNumber2: dto.taxNumber2,
      enableInlineTax: dto.enableInlineTax,

      skuPrefix: dto.skuPrefix,
      enableProductExpiry: dto.enableProductExpiry,
      expiryType: dto.expiryType,
      onProductExpiry: dto.onProductExpiry,
      stopSellingBefore: dto.stopSellingBefore,
      enableBrand: dto.enableBrand,
      enableCategory: dto.enableCategory,
      enableSubCategory: dto.enableSubCategory,
      enablePriceTax: dto.enablePriceTax,
      defaultUnit: dto.defaultUnit,
      enableSubUnits: dto.enableSubUnits,
      enableRacks: dto.enableRacks,
      enableRow: dto.enableRow,
      enablePosition: dto.enablePosition,

      defaultSalesDiscount: dto.defaultSalesDiscount,
      defaultSalesTax: dto.defaultSalesTax,
      sellPriceTax: dto.sellPriceTax,
      itemAdditionMethod: dto.itemAdditionMethod,
      salesCmsnAgnt: dto.salesCmsnAgnt,

      purchaseInDiffCurrency: dto.purchaseInDiffCurrency,
      pExchangeRate: dto.pExchangeRate,
      enableEditingProductFromPurchase: dto.enableEditingProductFromPurchase,
      enablePurchaseStatus: dto.enablePurchaseStatus,
      enableLotNumber: dto.enableLotNumber,

      stockExpiryAlertDays: dto.stockExpiryAlertDays,

      themeColor: dto.themeColor,
      enableTooltip: dto.enableTooltip,

      enableRp: dto.enableRp,
      rpName: dto.rpName,
      amountForUnitRp: dto.amountForUnitRp,
      minOrderTotalForRp: dto.minOrderTotalForRp,
      maxRpPerOrder: dto.maxRpPerOrder,
      redeemAmountPerUnitRp: dto.redeemAmountPerUnitRp,
      minOrderTotalForRedeem: dto.minOrderTotalForRedeem,
      minRedeemPoint: dto.minRedeemPoint,
      maxRedeemPoint: dto.maxRedeemPoint,
      rpExpiryPeriod: dto.rpExpiryPeriod,
      rpExpiryType: dto.rpExpiryType,

      posSettings: asJson(dto.posSettings),
      commonSettings: asJson(dto.commonSettings),
      refNoPrefixes: asJson(dto.refNoPrefixes),
      customLabels: asJson(dto.customLabels),
      emailSettings: asJson(dto.emailSettings),
      smsSettings: asJson(dto.smsSettings),
      weighingScaleSetting: asJson(dto.weighingScaleSetting),
      keyboardShortcuts: asJson(dto.keyboardShortcuts),
      enabledModules: asJson(dto.enabledModules),
    };

    // `purchase_currency_id` is nullable; only touch it when purchase-in-diff-currency is set.
    if (dto.purchaseCurrencyId != null) {
      data.purchaseCurrency = { connect: { id: dto.purchaseCurrencyId } };
    } else if (dto.purchaseInDiffCurrency === false) {
      data.purchaseCurrency = { disconnect: true };
    }

    const updated = await this.prisma.business.update({ where: { id: businessId }, data });
    return updated;
  }

  /**
   * POST /business/settings/logo — store a logo/login-logo image and set its column.
   * Persisted via StorageService: S3 when AWS_BUCKET is set, local disk otherwise.
   */
  async uploadLogo(businessId: number, type: 'logo' | 'login_logo', file?: UploadedImage) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!(type in LOGO_FIELDS)) throw new BadRequestException('Invalid logo type');
    if (!ALLOWED_IMAGE.includes(file.mimetype)) {
      throw new BadRequestException('Logo must be a PNG, JPG, GIF or WEBP image');
    }
    if (file.size > 2 * 1024 * 1024) {
      throw new BadRequestException('Logo must be under 2 MB');
    }

    const column = LOGO_FIELDS[type];
    const stored = await this.storage.put('business', file, `${businessId}-${type}`);
    await this.prisma.business.update({
      where: { id: businessId },
      data: { [column]: stored.path },
    });
    return { field: column, path: stored.path, url: stored.url };
  }
}
