import { BadRequestException } from '@nestjs/common';
import type { Prisma, TransactionStatus } from '@prisma/client';
import { round4 } from './purchase.calc';

/**
 * The draw-down chain: requisition → purchase order → purchase.
 *
 * Each level records how much of it the level below has consumed, in
 * `purchase_lines.po_quantity_purchased`, and its own status is nothing more than a reading of
 * that counter. GOURI gets this wrong in three ways, all fixed here:
 *
 *  - it does `$line->po_quantity_purchased += $diff; save()` — a read-modify-write, so two
 *    purchases receiving the same order concurrently lose one of the updates;
 *  - it never caps the counter, so a crafted request can drive it past the ordered quantity, and
 *    the order is then stuck at `partial` forever because `ordered == received` can never be true;
 *  - it compares `decimal(22,4)` sums with `==` on PHP floats, so fractional receipts strand an
 *    order at `partial` even when it is genuinely complete.
 */

/** Decimal(22,4) compared as floats needs a tolerance below the column's own precision. */
const EPSILON = 0.00005;

export interface DrawDown {
  /** The line being drawn down — a requisition line or a purchase-order line. */
  lineId: number;
  /** Signed change: positive when consuming, negative when giving back. */
  delta: number;
}

/** Net the deltas per line so one document's edits become a single write per line. */
export function netDrawDowns(entries: DrawDown[]): DrawDown[] {
  const byLine = new Map<number, number>();
  for (const e of entries) byLine.set(e.lineId, (byLine.get(e.lineId) ?? 0) + e.delta);
  return [...byLine.entries()]
    .map(([lineId, delta]) => ({ lineId, delta: round4(delta) }))
    .filter((e) => e.delta !== 0);
}

/**
 * Apply draw-downs and return the parent transaction ids whose status may have moved.
 *
 * The cap is checked first, against the rows as they are right now; the writes are then atomic
 * increments. Both happen inside the caller's transaction, so a concurrent receipt either sees
 * this one's committed effect or is serialised behind it.
 */
export async function applyDrawDowns(
  tx: Prisma.TransactionClient,
  entries: DrawDown[],
): Promise<number[]> {
  const net = netDrawDowns(entries);
  if (net.length === 0) return [];

  const lines = await tx.purchaseLine.findMany({
    where: { id: { in: net.map((e) => e.lineId) } },
    select: {
      id: true,
      quantity: true,
      poQuantityPurchased: true,
      transactionId: true,
      product: { select: { name: true } },
    },
  });
  const byId = new Map(lines.map((l) => [l.id, l]));

  for (const e of net) {
    const line = byId.get(e.lineId);
    if (!line) throw new BadRequestException('One or more order lines no longer exist');
    const next = round4(Number(line.poQuantityPurchased) + e.delta);
    if (next < -EPSILON) {
      throw new BadRequestException(
        `More of "${line.product.name}" would be returned to the order than was taken from it`,
      );
    }
    if (next - Number(line.quantity) > EPSILON) {
      const remaining = round4(Number(line.quantity) - Number(line.poQuantityPurchased));
      throw new BadRequestException(
        `Only ${remaining} of "${line.product.name}" is left on that order`,
      );
    }
  }

  await Promise.all(
    net.map((e) =>
      tx.purchaseLine.update({
        where: { id: e.lineId },
        data: { poQuantityPurchased: { increment: e.delta } },
      }),
    ),
  );

  return [...new Set(lines.map((l) => l.transactionId))];
}

/**
 * Re-read each document's lines and set its status from the counter.
 * A document with no lines stays `ORDERED` — GOURI would call it `completed`.
 */
export async function recomputeDrawDownStatus(
  tx: Prisma.TransactionClient,
  transactionIds: number[],
): Promise<void> {
  if (transactionIds.length === 0) return;

  const grouped = await tx.purchaseLine.groupBy({
    by: ['transactionId'],
    where: { transactionId: { in: transactionIds } },
    _sum: { quantity: true, poQuantityPurchased: true },
  });

  await Promise.all(
    grouped.map((g) => {
      const ordered = Number(g._sum.quantity ?? 0);
      const taken = Number(g._sum.poQuantityPurchased ?? 0);
      const status: TransactionStatus =
        taken <= EPSILON ? 'ORDERED' : ordered - taken <= EPSILON ? 'COMPLETED' : 'PARTIAL';
      return tx.transaction.update({ where: { id: g.transactionId }, data: { status } });
    }),
  );
}

/** How much of an order line is still available to draw down. */
export const remainingOf = (line: { quantity: unknown; poQuantityPurchased: unknown }): number =>
  round4(Number(line.quantity) - Number(line.poQuantityPurchased));
