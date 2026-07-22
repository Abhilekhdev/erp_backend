import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export interface StockMovement {
  locationId: number;
  productId: number;
  productVariationId: number;
  variationId: number;
  /** Signed: positive receives stock, negative issues it. */
  delta: Prisma.Decimal | number;
}

/**
 * The one place `variation_location_details` is written.
 *
 * Every stock movement in the app — purchases, sells, returns, transfers, adjustments, opening
 * stock — funnels through here so the running balance can only change one way.
 *
 * GOURI spreads this across `updateProductQuantity` (read-modify-write: `$vld->qty_available +=
 * $diff; save();`) and `decreaseProductQuantity` (atomic `decrement`), which look the row up by
 * DIFFERENT key sets — 4 columns vs 3. With no unique key on its table, increments and decrements
 * can land on different duplicate rows, and the read-modify-write loses updates under concurrency.
 * Ours is a single atomic upsert against a unique (variation, location).
 */
@Injectable()
export class StockService {
  /**
   * Apply one movement. A product with stock tracking off is skipped, exactly as GOURI does —
   * services and consumables have no balance to keep.
   */
  async move(tx: Prisma.TransactionClient, m: StockMovement): Promise<void> {
    const delta = Number(m.delta);
    if (!delta) return; // a no-op write would still bump updated_at for nothing

    const product = await tx.product.findUnique({
      where: { id: m.productId },
      select: { enableStock: true },
    });
    if (!product?.enableStock) return;

    await tx.variationLocationDetail.upsert({
      where: { variationId_locationId: { variationId: m.variationId, locationId: m.locationId } },
      create: {
        productId: m.productId,
        productVariationId: m.productVariationId,
        variationId: m.variationId,
        locationId: m.locationId,
        qtyAvailable: delta,
      },
      // Atomic: two concurrent receipts of the same variation cannot lose one another.
      update: { qtyAvailable: { increment: delta } },
    });
  }

  /** Apply several movements. Sequential on purpose — they may touch the same row. */
  async moveMany(tx: Prisma.TransactionClient, movements: StockMovement[]): Promise<void> {
    for (const m of movements) await this.move(tx, m);
  }

  /** Current balance of one variation at one location (0 when never stocked). */
  async available(
    tx: Prisma.TransactionClient,
    variationId: number,
    locationId: number,
  ): Promise<number> {
    const row = await tx.variationLocationDetail.findUnique({
      where: { variationId_locationId: { variationId, locationId } },
      select: { qtyAvailable: true },
    });
    return row ? Number(row.qtyAvailable) : 0;
  }
}
