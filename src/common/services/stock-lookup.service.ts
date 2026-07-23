import { Injectable } from '@nestjs/common';
import { type TransactionType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

const SOURCE_TYPES: TransactionType[] = ['PURCHASE', 'PURCHASE_TRANSFER', 'OPENING_STOCK'];

/**
 * Product / lot lookup at a location — feeds the stock-adjustment and stock-transfer forms
 * (both issue stock, so both need "what's here and what it cost").
 */
@Injectable()
export class StockLookupService {
  constructor(private readonly prisma: PrismaService) {}

  /** Variations of the business matching `search`, with current stock + last cost at `locationId`. */
  async searchVariations(businessId: number, locationId: number, search: string, limit = 25) {
    const q = search?.trim();
    const variations = await this.prisma.variation.findMany({
      where: {
        deletedAt: null,
        product: { businessId },
        ...(q
          ? {
              OR: [
                { product: { name: { contains: q, mode: 'insensitive' } } },
                { product: { sku: { contains: q, mode: 'insensitive' } } },
                { subSku: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      take: limit,
      select: {
        id: true,
        name: true,
        subSku: true,
        productVariationId: true,
        defaultPurchasePrice: true,
        product: { select: { id: true, name: true, enableStock: true } },
      },
      orderBy: { product: { name: 'asc' } },
    });

    const ids = variations.map((v) => v.id);
    const stock = ids.length
      ? await this.prisma.variationLocationDetail.findMany({
          where: { variationId: { in: ids }, locationId },
          select: { variationId: true, qtyAvailable: true },
        })
      : [];
    const stockBy = new Map(stock.map((s) => [s.variationId, Number(s.qtyAvailable)]));

    return variations.map((v) => ({
      productId: v.product.id,
      variationId: v.id,
      productVariationId: v.productVariationId,
      productName: v.product.name,
      variationName: v.name === 'DUMMY' ? null : v.name,
      subSku: v.subSku,
      enableStock: v.product.enableStock,
      currentStock: stockBy.get(v.id) ?? 0,
      unitPrice: Number(v.defaultPurchasePrice ?? 0),
    }));
  }

  /** Available purchase lots of one variation at one location (for the lot picker). */
  async lots(businessId: number, locationId: number, variationId: number) {
    const lots = await this.prisma.purchaseLine.findMany({
      where: {
        variationId,
        transaction: { businessId, locationId, type: { in: SOURCE_TYPES }, status: 'RECEIVED' },
      },
      select: {
        id: true,
        lotNumber: true,
        expDate: true,
        quantity: true,
        quantitySold: true,
        quantityReturned: true,
        quantityAdjusted: true,
        mfgQuantityUsed: true,
        purchasePrice: true,
      },
      orderBy: { id: 'asc' },
    });
    return lots
      .map((l) => ({
        purchaseLineId: l.id,
        lotNumber: l.lotNumber,
        expDate: l.expDate,
        unitPrice: Number(l.purchasePrice),
        available:
          Number(l.quantity) -
          Number(l.quantitySold) -
          Number(l.quantityReturned) -
          Number(l.quantityAdjusted) -
          Number(l.mfgQuantityUsed),
      }))
      .filter((l) => l.available > 0.00005);
  }
}
