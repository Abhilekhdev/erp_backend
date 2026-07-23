import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { ReferenceNumberService } from '../../common/services/reference-number.service';
import { StockService, type StockMovement } from '../../common/services/stock.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../auth/token.service';
import { round4 } from '../purchases/purchase.calc';
import type { SaveOpeningStockDto } from './dto/opening-stock.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);
const date = (v?: string | null): Date | null => (v ? new Date(v) : null);

/**
 * Opening stock — the quantity a product already had on the shelf before the system started
 * tracking it. GOURI records it as an `opening_stock` transaction (status `received`) whose
 * purchase lines carry the starting lots; the stock posts exactly like a purchase.
 *
 * We store one such transaction per (product, location). The save REPLACES the product's whole
 * opening stock: existing lots are reversed out of stock and deleted, the new set is posted. That
 * is only safe while none of the opening lots has been consumed — a guard blocks the edit if any
 * has been sold/adjusted/returned, so we never strand a FIFO allocation.
 *
 * Divergences from GOURI, all deliberate:
 *  - GOURI trusts a per-line `transaction_date` with no validation and sums the document total
 *    wrong (last line only); we take one document date and sum correctly.
 *  - GOURI's edit loads `PurchaseLine::findOrFail(id)` with no business scope (an IDOR); every
 *    lookup here is tenant-scoped.
 *  - GOURI generates no reference number; we do (`OS{year}/{0000}`) so stock history can name it.
 */
@Injectable()
export class OpeningStockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly refs: ReferenceNumberService,
    private readonly audit: AuditService,
  ) {}

  /** The form: assigned locations, every variation, existing lots, and the field-gating settings. */
  async get(businessId: number, productId: number) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, businessId },
      select: {
        id: true,
        name: true,
        enableStock: true,
        taxRateId: true,
        secondaryUnitId: true,
        unitId: true,
        productVariations: {
          orderBy: { id: 'asc' },
          select: {
            name: true,
            variations: {
              where: { deletedAt: null },
              orderBy: { id: 'asc' },
              select: { id: true, name: true, subSku: true, defaultPurchasePrice: true },
            },
          },
        },
        locations: { select: { location: { select: { id: true, name: true } } } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (!product.enableStock) {
      throw new BadRequestException('This product does not track stock, so it has no opening stock');
    }

    const [business, existing] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { enableLotNumber: true, enableProductExpiry: true, startDate: true },
      }),
      this.prisma.transaction.findMany({
        where: { businessId, type: 'OPENING_STOCK', purchaseLines: { some: { productId } } },
        select: {
          locationId: true,
          purchaseLines: {
            where: { productId },
            orderBy: { id: 'asc' },
            select: {
              id: true,
              variationId: true,
              quantity: true,
              purchasePrice: true,
              expDate: true,
              lotNumber: true,
              secondaryUnitQuantity: true,
            },
          },
        },
      }),
    ]);

    const unit = product.unitId
      ? await this.prisma.unit.findUnique({ where: { id: product.unitId }, select: { shortName: true } })
      : null;

    const variations = product.productVariations.flatMap((pv) =>
      pv.variations.map((v) => ({
        variationId: v.id,
        // Only a variable product has a meaningful variation label.
        label: pv.name === 'DUMMY' ? '' : `${pv.name} - ${v.name}`,
        sku: v.subSku ?? '',
        defaultPurchasePrice: v.defaultPurchasePrice != null ? Number(v.defaultPurchasePrice) : 0,
      })),
    );

    // Existing lots, keyed for the form: locationId → variationId → lot[].
    const lots: Record<number, Record<number, unknown[]>> = {};
    for (const t of existing) {
      for (const l of t.purchaseLines) {
        ((lots[t.locationId] ??= {})[l.variationId] ??= []).push({
          purchaseLineId: l.id,
          quantity: Number(l.quantity),
          purchasePrice: Number(l.purchasePrice),
          expDate: l.expDate ? l.expDate.toISOString().slice(0, 10) : '',
          lotNumber: l.lotNumber ?? '',
          secondaryUnitQuantity: Number(l.secondaryUnitQuantity),
        });
      }
    }

    return {
      product: { id: product.id, name: product.name, unitName: unit?.shortName ?? '' },
      locations: product.locations.map((pl) => ({ id: pl.location.id, name: pl.location.name })),
      variations,
      existingLots: lots,
      settings: {
        enableLotNumber: business.enableLotNumber,
        enableProductExpiry: business.enableProductExpiry,
        hasSecondaryUnit: product.secondaryUnitId != null,
        defaultDate: (business.startDate ?? new Date()).toISOString().slice(0, 10),
      },
    };
  }

  async save(user: AccessPayload, productId: number, dto: SaveOpeningStockDto) {
    const businessId = user.businessId as number;
    const product = await this.prisma.product.findFirst({
      where: { id: productId, businessId },
      select: { id: true, name: true, enableStock: true, taxRateId: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (!product.enableStock) {
      throw new BadRequestException('This product does not track stock');
    }

    // Validate the referenced locations and variations belong to this product/tenant.
    const rows = dto.lots.filter((l) => Number(l.quantity) > 0);
    const locationIds = [...new Set(rows.map((l) => l.location_id))];
    const variationIds = [...new Set(rows.map((l) => l.variation_id))];

    if (locationIds.length) {
      const assigned = await this.prisma.productLocation.count({
        where: { productId, locationId: { in: locationIds }, location: { businessId, deletedAt: null } },
      });
      if (assigned !== locationIds.length) {
        throw new BadRequestException('Opening stock can only be set at a location the product is sold at');
      }
    }
    const variations = variationIds.length
      ? await this.prisma.variation.findMany({
          where: { id: { in: variationIds }, productId, deletedAt: null },
          select: { id: true, productId: true, productVariationId: true },
        })
      : [];
    if (variations.length !== variationIds.length) {
      throw new BadRequestException('One or more variations are invalid for this product');
    }
    const variationById = new Map(variations.map((v) => [v.id, v]));

    // Tax comes from the product, as GOURI does.
    const taxPercent = product.taxRateId
      ? Number(
          (await this.prisma.taxRate.findUnique({ where: { id: product.taxRateId }, select: { amount: true } }))
            ?.amount ?? 0,
        )
      : 0;

    // The existing opening stock we are about to replace.
    const existing = await this.prisma.transaction.findMany({
      where: { businessId, type: 'OPENING_STOCK', purchaseLines: { some: { productId } } },
      include: {
        purchaseLines: {
          where: { productId },
          include: { variation: { select: { productVariationId: true } } },
        },
      },
    });

    // A lot that has already been drawn down cannot be safely rewritten.
    for (const t of existing) {
      for (const l of t.purchaseLines) {
        if (
          Number(l.quantitySold) > 0 ||
          Number(l.quantityAdjusted) > 0 ||
          Number(l.quantityReturned) > 0 ||
          Number(l.mfgQuantityUsed) > 0
        ) {
          throw new ConflictException(
            'Some of this opening stock has already been sold or adjusted — it can no longer be edited',
          );
        }
      }
    }

    const txnDate = date(dto.transaction_date) ?? new Date();

    await this.prisma.$transaction(
      async (tx) => {
        // 1) Reverse and remove the old opening stock.
        for (const t of existing) {
          const reversals: StockMovement[] = t.purchaseLines.map((l) => ({
            locationId: t.locationId,
            productId: l.productId,
            productVariationId: l.variation.productVariationId,
            variationId: l.variationId,
            delta: -Number(l.quantity),
          }));
          await this.stock.moveMany(tx, reversals);
        }
        if (existing.length) {
          await tx.transaction.deleteMany({ where: { id: { in: existing.map((t) => t.id) } } });
        }

        // 2) Create one transaction per location and post its stock.
        const byLocation = new Map<number, typeof rows>();
        for (const l of rows) {
          const arr = byLocation.get(l.location_id) ?? [];
          arr.push(l);
          byLocation.set(l.location_id, arr);
        }

        for (const [locationId, lots] of byLocation) {
          const lines = lots.map((l) => {
            const price = round4(Number(l.purchase_price) || 0);
            const itemTax = round4((taxPercent / 100) * price);
            return {
              productId,
              variationId: l.variation_id,
              quantity: round4(Number(l.quantity)),
              ppWithoutDiscount: price,
              purchasePrice: price,
              itemTax,
              purchasePriceIncTax: round4(price + itemTax),
              taxRateId: product.taxRateId,
              expDate: date(l.exp_date),
              lotNumber: blank(l.lot_number),
              secondaryUnitQuantity: round4(Number(l.secondary_unit_quantity) || 0),
            };
          });
          const finalTotal = round4(lines.reduce((s, l) => s + l.quantity * l.purchasePriceIncTax, 0));
          const refNo = await this.refs.generate(businessId, 'opening_stock', 'OS');

          await tx.transaction.create({
            data: {
              businessId,
              locationId,
              type: 'OPENING_STOCK',
              status: 'RECEIVED',
              refNo,
              transactionDate: txnDate,
              lineSubtotal: finalTotal,
              finalTotal,
              paymentStatus: 'PAID',
              additionalNotes: blank(lots.find((l) => l.note)?.note ?? null),
              createdBy: user.sub,
              purchaseLines: { create: lines },
            },
          });

          await this.stock.moveMany(
            tx,
            lots.map((l) => ({
              locationId,
              productId,
              productVariationId: variationById.get(l.variation_id)!.productVariationId,
              variationId: l.variation_id,
              delta: round4(Number(l.quantity)),
            })),
          );
        }
      },
      { timeout: 30000 },
    );

    await this.audit.record({
      model: 'OpeningStock',
      subjectId: product.id,
      name: product.name,
      action: existing.length ? 'updated' : 'created',
      after: { lots: rows.length, locations: locationIds.length },
    });

    return this.get(businessId, productId);
  }
}
