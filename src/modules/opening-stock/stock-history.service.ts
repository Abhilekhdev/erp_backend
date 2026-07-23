import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { round4 } from '../purchases/purchase.calc';

/**
 * Product stock history — a read-only ledger of every movement of one variation at one location,
 * plus the in/out summary boxes. GOURI's `getVariationStockHistory` / `getVariationStockDetails`.
 *
 * Crucially READ-ONLY: GOURI's version, on this GET, overwrites `variation_location_details` with
 * the ledger's running total whenever the two disagree — so merely viewing history silently mutates
 * inventory. We compute the running total for display and never write it back.
 *
 * Only the movement types that exist today produce rows (opening stock, purchases, purchase
 * returns). Sells, transfers and adjustments join automatically as those modules land, because the
 * query already covers their transaction types.
 */
@Injectable()
export class StockHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Locations + variations for the history screen's dropdowns. */
  async meta(businessId: number, productId: number) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, businessId },
      select: {
        id: true,
        name: true,
        type: true,
        enableStock: true,
        unitId: true,
        productVariations: {
          orderBy: { id: 'asc' },
          select: {
            name: true,
            variations: {
              where: { deletedAt: null },
              orderBy: { id: 'asc' },
              select: { id: true, name: true, subSku: true },
            },
          },
        },
        locations: { select: { location: { select: { id: true, name: true } } } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    const unit = product.unitId
      ? await this.prisma.unit.findUnique({ where: { id: product.unitId }, select: { shortName: true } })
      : null;

    return {
      product: {
        id: product.id,
        name: product.name,
        type: product.type,
        enableStock: product.enableStock,
        unitName: unit?.shortName ?? '',
      },
      // Every location the business has — history is per location, and a variation can have moved at
      // a location it is no longer assigned to.
      locations: (
        await this.prisma.businessLocation.findMany({
          where: { businessId, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      ).map((l) => ({ id: l.id, name: l.name })),
      variations: product.productVariations.flatMap((pv) =>
        pv.variations.map((v) => ({
          variationId: v.id,
          label: pv.name === 'DUMMY' ? '' : `${pv.name} - ${v.name}`,
          sku: v.subSku ?? '',
        })),
      ),
    };
  }

  async history(businessId: number, variationId: number, locationId: number) {
    const variation = await this.prisma.variation.findFirst({
      where: { id: variationId, product: { businessId } },
      select: { id: true, productId: true },
    });
    if (!variation) throw new BadRequestException('Variation not found');

    // ── in/out summary boxes ──────────────────────────────
    // Purchase-side lines carry opening stock, purchases and their returns/adjustments.
    const purchaseLines = await this.prisma.purchaseLine.findMany({
      where: {
        variationId,
        transaction: { businessId, locationId },
      },
      select: {
        quantity: true,
        quantityReturned: true,
        quantityAdjusted: true,
        transaction: { select: { type: true, status: true } },
      },
    });

    let totalPurchase = 0;
    let openingStock = 0;
    let totalPurchaseReturn = 0;
    let totalAdjusted = 0;
    for (const l of purchaseLines) {
      const t = l.transaction;
      if (t.type === 'PURCHASE' && t.status === 'RECEIVED') totalPurchase += Number(l.quantity);
      if (t.type === 'OPENING_STOCK') openingStock += Number(l.quantity);
      if (t.type === 'PURCHASE_RETURN') totalPurchaseReturn += Number(l.quantity);
      // Adjustments consume a purchase lot — GOURI reads this off quantity_adjusted.
      totalAdjusted += Number(l.quantityAdjusted);
    }

    const currentRow = await this.prisma.variationLocationDetail.findUnique({
      where: { variationId_locationId: { variationId, locationId } },
      select: { qtyAvailable: true },
    });
    const currentStock = currentRow ? Number(currentRow.qtyAvailable) : 0;

    // ── ledger ────────────────────────────────────────────
    // Every transaction of a stock-moving type that touched this variation at this location.
    const txns = await this.prisma.transaction.findMany({
      where: {
        businessId,
        locationId,
        type: {
          in: ['PURCHASE', 'OPENING_STOCK', 'PURCHASE_RETURN', 'STOCK_ADJUSTMENT', 'SELL', 'SELL_RETURN', 'PURCHASE_TRANSFER', 'SELL_TRANSFER'],
        },
        purchaseLines: { some: { variationId } },
      },
      orderBy: [{ transactionDate: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        type: true,
        status: true,
        refNo: true,
        transactionDate: true,
        additionalNotes: true,
        contact: { select: { name: true, supplierBusinessName: true } },
        purchaseLines: {
          where: { variationId },
          select: { quantity: true, quantityReturned: true },
        },
      },
    });

    const LEDGER: Record<string, { label: string; sign: 1 | -1; field: 'quantity' | 'quantityReturned'; status?: string }> = {
      OPENING_STOCK: { label: 'Opening stock', sign: 1, field: 'quantity' },
      PURCHASE: { label: 'Purchase', sign: 1, field: 'quantity', status: 'RECEIVED' },
      PURCHASE_RETURN: { label: 'Purchase return', sign: -1, field: 'quantity' },
      PURCHASE_TRANSFER: { label: 'Stock transfer (in)', sign: 1, field: 'quantity', status: 'RECEIVED' },
      SELL: { label: 'Sale', sign: -1, field: 'quantity', status: 'FINAL' },
      SELL_TRANSFER: { label: 'Stock transfer (out)', sign: -1, field: 'quantity', status: 'FINAL' },
      SELL_RETURN: { label: 'Sell return', sign: 1, field: 'quantityReturned' },
      STOCK_ADJUSTMENT: { label: 'Stock adjustment', sign: -1, field: 'quantity' },
    };

    let running = 0;
    const rows: {
      type: string;
      label: string;
      date: Date;
      refNo: string;
      quantityChange: number;
      newQuantity: number;
      contact: string;
    }[] = [];

    for (const t of txns) {
      const cfg = LEDGER[t.type];
      if (!cfg) continue;
      // A draft/pending document has not moved stock, so it must not appear as a ledger entry.
      if (cfg.status && t.status !== cfg.status) continue;

      const qty = t.purchaseLines.reduce((s, l) => s + Number(l[cfg.field]), 0);
      if (qty === 0) continue;
      const change = round4(cfg.sign * qty);
      running = round4(running + change);
      rows.push({
        type: t.type,
        label: cfg.label,
        date: t.transactionDate,
        refNo: t.refNo ?? '',
        quantityChange: change,
        newQuantity: running,
        contact: t.contact?.supplierBusinessName || t.contact?.name || '',
      });
    }

    // Newest first for display, exactly as GOURI reverses the date-asc list.
    rows.reverse();

    return {
      summary: {
        // in
        totalPurchase: round4(totalPurchase),
        openingStock: round4(openingStock),
        totalStockTransferIn: null as number | null, // no transfers module yet
        totalSellReturn: null as number | null, // no sells module yet
        // out
        totalSold: null as number | null, // no sells module yet
        totalStockAdjustment: round4(totalAdjusted),
        totalPurchaseReturn: round4(totalPurchaseReturn),
        totalStockTransferOut: null as number | null,
        // totals
        currentStock: round4(currentStock),
      },
      rows,
    };
  }
}
