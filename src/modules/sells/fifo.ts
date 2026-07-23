import { BadRequestException } from '@nestjs/common';
import type { Prisma, TransactionType } from '@prisma/client';
import { round4 } from '../purchases/purchase.calc';

/**
 * FIFO/LIFO cost-of-goods allocation — the sell side's counterpart to the purchase draw-down.
 *
 * When a sell issues stock, each sold unit is allocated to a purchase LOT (a `purchase_line`) so
 * the cost is known and a return can free the exact lots it came from. GOURI does this in
 * `mapPurchaseSell`; we keep its shape but fix its faults:
 *  - it reads `quantity − Σsold` then writes `quantity_sold += qty` with no lock (two concurrent
 *    finals double-allocate) — here every counter move is an atomic `increment`;
 *  - when stock is short it either throws OR (if `allow_overselling`) writes a `purchase_line_id=0`
 *    sentinel row and lets `qty_available` go negative — here overselling is refused outright with
 *    a clear message, so a read never sees negative stock.
 */

const EPSILON = 0.00005;

/** Lots that can still be sold from: received/opening stock with quantity left. */
const SOURCE_TYPES: TransactionType[] = ['PURCHASE', 'PURCHASE_TRANSFER', 'OPENING_STOCK'];

export interface AllocationTarget {
  sellLineId: number;
  productId: number;
  variationId: number;
  /** Base-unit quantity to allocate. */
  quantity: number;
  productName: string;
}

/**
 * Allocate `quantity` of a variation at a location to purchase lots, oldest first (or newest for
 * LIFO). Writes the mapping rows and bumps each lot's `quantity_sold`. Throws if stock is short.
 */
export async function allocateFifo(
  tx: Prisma.TransactionClient,
  opts: { businessId: number; locationId: number; lifo: boolean },
  target: AllocationTarget,
): Promise<void> {
  let remaining = round4(target.quantity);
  if (remaining <= 0) return;

  const lots = await tx.purchaseLine.findMany({
    where: {
      productId: target.productId,
      variationId: target.variationId,
      transaction: {
        businessId: opts.businessId,
        locationId: opts.locationId,
        type: { in: SOURCE_TYPES },
        status: 'RECEIVED',
      },
    },
    select: {
      id: true,
      quantity: true,
      quantitySold: true,
      quantityReturned: true,
      quantityAdjusted: true,
      mfgQuantityUsed: true,
      transaction: { select: { transactionDate: true } },
    },
    // FIFO = oldest lot first; the id keeps it stable within a day.
    orderBy: [{ transaction: { transactionDate: opts.lifo ? 'desc' : 'asc' } }, { id: opts.lifo ? 'desc' : 'asc' }],
  });

  for (const lot of lots) {
    if (remaining <= EPSILON) break;
    const available = round4(
      Number(lot.quantity) -
        Number(lot.quantitySold) -
        Number(lot.quantityReturned) -
        Number(lot.quantityAdjusted) -
        Number(lot.mfgQuantityUsed),
    );
    if (available <= EPSILON) continue;

    const take = Math.min(remaining, available);
    await tx.sellPurchaseAllocation.create({
      data: { sellLineId: target.sellLineId, purchaseLineId: lot.id, quantity: round4(take) },
    });
    await tx.purchaseLine.update({
      where: { id: lot.id },
      data: { quantitySold: { increment: round4(take) } },
    });
    remaining = round4(remaining - take);
  }

  if (remaining > EPSILON) {
    throw new BadRequestException(
      `Not enough stock of "${target.productName}" at this location — short by ${remaining}`,
    );
  }
}

/**
 * Undo a sell line's allocations: give each lot its `quantity_sold` back and delete the map rows.
 * Used on edit (reverse-then-reallocate) and delete.
 */
export async function deallocateSellLine(tx: Prisma.TransactionClient, sellLineId: number): Promise<void> {
  const allocations = await tx.sellPurchaseAllocation.findMany({
    where: { sellLineId },
    select: { id: true, purchaseLineId: true, quantity: true, qtyReturned: true },
  });
  for (const a of allocations) {
    // Only the part not already returned is still counted as sold.
    const stillSold = round4(Number(a.quantity) - Number(a.qtyReturned));
    if (stillSold > 0) {
      await tx.purchaseLine.update({
        where: { id: a.purchaseLineId },
        data: { quantitySold: { decrement: stillSold } },
      });
    }
  }
  await tx.sellPurchaseAllocation.deleteMany({ where: { sellLineId } });
}

/**
 * Free `quantity` of a sell line back to its lots on a return: walk its allocations newest-first,
 * decrement each lot's `quantity_sold`, and record how much of each allocation was returned.
 */
export async function returnSellLineQuantity(
  tx: Prisma.TransactionClient,
  sellLineId: number,
  quantity: number,
): Promise<void> {
  let remaining = round4(quantity);
  if (remaining <= 0) return;

  const allocations = await tx.sellPurchaseAllocation.findMany({
    where: { sellLineId },
    select: { id: true, purchaseLineId: true, quantity: true, qtyReturned: true },
    orderBy: { id: 'desc' },
  });

  for (const a of allocations) {
    if (remaining <= EPSILON) break;
    const freeable = round4(Number(a.quantity) - Number(a.qtyReturned));
    if (freeable <= EPSILON) continue;
    const give = Math.min(remaining, freeable);
    await tx.sellPurchaseAllocation.update({
      where: { id: a.id },
      data: { qtyReturned: { increment: round4(give) } },
    });
    await tx.purchaseLine.update({
      where: { id: a.purchaseLineId },
      data: { quantitySold: { decrement: round4(give) } },
    });
    remaining = round4(remaining - give);
  }
  // Any leftover (allocations gone) is silently ignored — the stock is still restored by the caller.
}
