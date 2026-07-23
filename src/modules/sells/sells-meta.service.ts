import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { round4 } from './sell.calc';

/**
 * Everything the sell form needs that isn't a write: customer/location/tax dropdowns, the business
 * toggles that decide which fields exist, and the product picker (per-variation, with the sell
 * price and the stock on hand at the chosen location).
 */
@Injectable()
export class SellsMetaService {
  constructor(private readonly prisma: PrismaService) {}

  async meta(businessId: number) {
    const [business, locations, customers, taxRates, priceGroups] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: {
          enableInlineTax: true,
          enableSubUnits: true,
          currencyPrecision: true,
          quantityPrecision: true,
          currency: { select: { code: true, symbol: true } },
        },
      }),
      this.prisma.businessLocation.findMany({
        where: { businessId, deletedAt: null, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.contact.findMany({
        where: { businessId, deletedAt: null, type: { in: ['customer', 'both'] }, contactStatus: 'active' },
        select: {
          id: true, name: true, supplierBusinessName: true, mobile: true,
          payTermNumber: true, payTermType: true,
          addressLine1: true, addressLine2: true, city: true, state: true, country: true, zipCode: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.taxRate.findMany({
        where: { businessId, deletedAt: null, forTaxGroup: false },
        select: { id: true, name: true, amount: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.sellingPriceGroup.findMany({
        where: { businessId, deletedAt: null, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      locations,
      customers: customers.map((c) => ({
        id: c.id,
        name: c.name || c.supplierBusinessName || '',
        mobile: c.mobile ?? '',
        payTermNumber: c.payTermNumber,
        payTermType: c.payTermType?.toLowerCase() ?? null,
        address: [c.addressLine1, c.addressLine2, c.city, c.state, c.country, c.zipCode]
          .map((p) => p?.trim())
          .filter(Boolean)
          .join(', '),
      })),
      taxRates: taxRates.map((t) => ({ id: t.id, name: t.name, amount: Number(t.amount) })),
      priceGroups,
      paymentMethods: [
        { value: 'cash', label: 'Cash' },
        { value: 'card', label: 'Card' },
        { value: 'cheque', label: 'Cheque' },
        { value: 'bank_transfer', label: 'Bank Transfer' },
        { value: 'other', label: 'Other' },
      ],
      settings: {
        enableInlineTax: business.enableInlineTax,
        enableSubUnits: business.enableSubUnits,
        currencyPrecision: business.currencyPrecision,
        quantityPrecision: business.quantityPrecision,
        currency: business.currency,
      },
    };
  }

  /**
   * Product picker for the line table — one row per VARIATION with its sell price (a selling-price
   * group overrides it) and the stock at the chosen location. Combos and inactive products are out.
   */
  async searchProducts(businessId: number, search: string, locationId?: number, priceGroupId?: number) {
    const s = search.trim();
    if (s.length < 1) return { data: [] };

    const variations = await this.prisma.variation.findMany({
      where: {
        deletedAt: null,
        product: {
          businessId,
          isInactive: false,
          notForSelling: false,
          type: { not: 'combo' },
          ...(locationId ? { OR: [{ locations: { some: { locationId } } }, { locations: { none: {} } }] } : {}),
        },
        OR: [
          { subSku: { contains: s, mode: 'insensitive' } },
          { product: { name: { contains: s, mode: 'insensitive' } } },
          { product: { sku: { contains: s, mode: 'insensitive' } } },
        ],
      },
      include: {
        productVariation: { select: { name: true } },
        product: {
          select: { id: true, name: true, type: true, enableStock: true, taxRateId: true, unitId: true },
        },
        groupPrices: priceGroupId
          ? { where: { priceGroupId }, select: { priceIncTax: true } }
          : false,
        stockLevels: { where: { locationId: locationId ?? -1 }, select: { qtyAvailable: true } },
      },
      orderBy: { id: 'asc' },
      take: 30,
    });

    const unitIds = [...new Set(variations.map((v) => v.product.unitId).filter(Boolean) as number[])];
    const units = unitIds.length
      ? await this.prisma.unit.findMany({
          where: { businessId, deletedAt: null, OR: [{ id: { in: unitIds } }, { baseUnitId: { in: unitIds } }] },
          select: { id: true, actualName: true, shortName: true, allowDecimal: true, baseUnitId: true, baseUnitMultiplier: true },
        })
      : [];
    const unitById = new Map(units.map((u) => [u.id, u]));
    const subUnits = units.filter((u) => u.baseUnitId != null);

    return {
      data: variations.map((v) => {
        const p = v.product;
        const unit = p.unitId ? unitById.get(p.unitId) : undefined;
        const stock = locationId ? v.stockLevels : null;
        const groupPrice =
          priceGroupId && Array.isArray(v.groupPrices) && v.groupPrices.length
            ? Number(v.groupPrices[0].priceIncTax)
            : null;
        return {
          variationId: v.id,
          productId: p.id,
          name: p.name,
          variation: p.type === 'variable' ? `${v.productVariation.name} - ${v.name}` : '',
          sku: v.subSku ?? '',
          enableStock: p.enableStock,
          currentStock: stock ? round4(stock.reduce((sum, sl) => sum + Number(sl.qtyAvailable), 0)) : null,
          taxRateId: p.taxRateId,
          unitId: p.unitId,
          unitName: unit?.shortName ?? '',
          allowDecimal: unit?.allowDecimal ?? true,
          subUnits: subUnits
            .filter((u) => u.baseUnitId === p.unitId)
            .map((u) => ({ id: u.id, name: u.actualName, shortName: u.shortName, multiplier: Number(u.baseUnitMultiplier ?? 1) })),
          /** The sell price the line defaults to: the price-group rate when one is chosen, else the base. */
          defaultSellPrice: v.defaultSellPrice != null ? Number(v.defaultSellPrice) : 0,
          sellPriceIncTax: groupPrice ?? (v.sellPriceIncTax != null ? Number(v.sellPriceIncTax) : 0),
        };
      }),
    };
  }
}
