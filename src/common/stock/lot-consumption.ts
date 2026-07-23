import { BadRequestException } from '@nestjs/common';
import { type Prisma, type TransactionType } from '@prisma/client';
import { round4 } from '../../modules/purchases/purchase.calc';

/**
 * Generic FIFO/LIFO lot consumption — the shared engine behind stock adjustments and the source
 * side of stock transfers (and reusable by any future issuer).
 *
 * It walks a variation's purchase lots at a location oldest-first (or newest for LIFO), bumps the
 * given per-lot counter (`quantityAdjusted` for adjustments, `quantitySold` for transfers) with an
 * atomic increment, and returns the allocations so the caller can persist them and reverse exactly.
 * Overselling is refused outright — a read never sees negative stock. This deliberately does NOT
 * touch the sells module's `sell_purchase_allocations` table; each caller owns its own reversal map.
 */

const EPSILON = 0.00005;
const SOURCE_TYPES: TransactionType[] = ['PURCHASE', 'PURCHASE_TRANSFER', 'OPENING_STOCK'];

export type LotCounter = 'quantityAdjusted' | 'quantitySold';

export interface LotAllocation {
  purchaseLineId: number;
  quantity: number;
  purchasePrice: number;
  purchasePriceIncTax: number;
  lotNumber: string | null;
  mfgDate: Date | null;
  expDate: Date | null;
  taxRateId: number | null;
}

export async function consumeLots(
  tx: Prisma.TransactionClient,
  opts: {
    businessId: number;
    locationId: number;
    productId: number;
    variationId: number;
    quantity: number;
    counter: LotCounter;
    lifo: boolean;
    lotNoLineId?: number | null;
    productName?: string;
  },
): Promise<LotAllocation[]> {
  let remaining = round4(opts.quantity);
  const out: LotAllocation[] = [];
  if (remaining <= 0) return out;

  const lots = await tx.purchaseLine.findMany({
    where: {
      productId: opts.productId,
      variationId: opts.variationId,
      ...(opts.lotNoLineId ? { id: opts.lotNoLineId } : {}),
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
      purchasePrice: true,
      purchasePriceIncTax: true,
      lotNumber: true,
      mfgDate: true,
      expDate: true,
      taxRateId: true,
      transaction: { select: { transactionDate: true } },
    },
    orderBy: [
      { transaction: { transactionDate: opts.lifo ? 'desc' : 'asc' } },
      { id: opts.lifo ? 'desc' : 'asc' },
    ],
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
    await tx.purchaseLine.update({
      where: { id: lot.id },
      data: { [opts.counter]: { increment: round4(take) } } as Prisma.PurchaseLineUpdateInput,
    });
    out.push({
      purchaseLineId: lot.id,
      quantity: round4(take),
      purchasePrice: Number(lot.purchasePrice),
      purchasePriceIncTax: Number(lot.purchasePriceIncTax),
      lotNumber: lot.lotNumber,
      mfgDate: lot.mfgDate,
      expDate: lot.expDate,
      taxRateId: lot.taxRateId,
    });
    remaining = round4(remaining - take);
  }

  if (remaining > EPSILON) {
    throw new BadRequestException(
      `Not enough stock of "${opts.productName ?? 'product'}" at this location — short by ${remaining}`,
    );
  }
  return out;
}

/** Give each lot its counter back (reverse of consumeLots) — used on delete. */
export async function reverseLots(
  tx: Prisma.TransactionClient,
  allocations: { purchaseLineId: number; quantity: number }[],
  counter: LotCounter,
): Promise<void> {
  for (const a of allocations) {
    if (Number(a.quantity) > 0) {
      await tx.purchaseLine.update({
        where: { id: a.purchaseLineId },
        data: { [counter]: { decrement: round4(Number(a.quantity)) } } as Prisma.PurchaseLineUpdateInput,
      });
    }
  }
}
