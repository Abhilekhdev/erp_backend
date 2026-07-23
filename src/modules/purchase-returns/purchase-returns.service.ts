import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { AbilityService } from '../../common/services/ability.service';
import { ReferenceNumberService } from '../../common/services/reference-number.service';
import { StockService, type StockMovement } from '../../common/services/stock.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../auth/token.service';
import { paymentStatusFor, round4 } from '../purchases/purchase.calc';
import type {
  PurchaseReturnsQueryDto,
  SavePurchaseReturnDto,
  SaveReturnPaymentDto,
} from './dto/purchase-return.dto';

const endOfDay = (d: Date) => new Date(new Date(d).setHours(23, 59, 59, 999));
const EPSILON = 0.00005;

/**
 * Purchase returns — goods sent back to the supplier.
 *
 * GOURI has TWO implementations of this sharing one `type`: a "linked" one that creates no lines
 * at all and records the return only by overwriting `quantity_returned` on the parent purchase
 * (so there can be at most one return per purchase, and a line left out of the form is silently
 * reset to zero), and a "combined" one whose parent link is commented out, whose reference number
 * is written to the wrong column, and whose stock moves in the opposite direction. We implement
 * exactly one flow:
 *
 *   - a return is its own document with its own lines, each pointing at the purchase line it
 *     reverses (`parent_line_id`), so several partial returns against one purchase are just
 *     several documents and none of them can erase another;
 *   - the parent's `quantity_returned` is an atomic increment, capped at what is actually left;
 *   - stock only moves if the parent purchase ever posted any — returning against a pending or
 *     unapproved purchase must not drive the balance negative.
 */
@Injectable()
export class PurchaseReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly refs: ReferenceNumberService,
    private readonly audit: AuditService,
    private readonly ability: AbilityService,
  ) {}

  /** A return only reverses stock that was actually posted. */
  private postedStock(status: string, isApproved: boolean): boolean {
    return status === 'RECEIVED' && isApproved;
  }

  /** What is still returnable on a purchase line, ignoring one return's own contribution. */
  private returnable(
    line: { quantity: unknown; quantitySold: unknown; quantityAdjusted: unknown; quantityReturned: unknown },
    ownContribution = 0,
  ): number {
    return round4(
      Number(line.quantity) -
        Number(line.quantitySold) -
        Number(line.quantityAdjusted) -
        (Number(line.quantityReturned) - ownContribution),
    );
  }

  private async loadParent(businessId: number, purchaseId: number) {
    const parent = await this.prisma.transaction.findFirst({
      where: { id: purchaseId, businessId, type: 'PURCHASE' },
      include: {
        purchaseLines: {
          include: {
            product: { select: { id: true, name: true } },
            variation: { select: { id: true, productVariationId: true } },
          },
        },
      },
    });
    if (!parent) throw new BadRequestException('The purchase being returned does not exist');
    return parent;
  }

  /**
   * Turn the requested lines into stored rows and totals.
   * `existingByParent` carries what THIS return already sends back, so an edit is measured
   * against its own previous state rather than double-counting it.
   */
  private build(
    parent: Awaited<ReturnType<typeof this.loadParent>>,
    dto: SavePurchaseReturnDto,
    taxPercent: number,
    existingByParent = new Map<number, number>(),
  ) {
    const parentLines = new Map(parent.purchaseLines.map((l) => [l.id, l]));

    const rows = dto.returns
      .filter((r) => Number(r.quantity) > 0)
      .map((r) => {
        const line = parentLines.get(r.parent_line_id);
        if (!line) throw new BadRequestException('One or more lines do not belong to that purchase');

        const quantity = round4(Number(r.quantity));
        const allowed = this.returnable(line, existingByParent.get(line.id) ?? 0);
        if (quantity - allowed > EPSILON) {
          throw new BadRequestException(
            `Only ${allowed} of "${line.product.name}" can be returned — the rest is already sold, adjusted or returned`,
          );
        }

        return {
          parentLineId: line.id,
          productId: line.productId,
          variationId: line.variationId,
          productVariationId: line.variation.productVariationId,
          data: {
            productId: line.productId,
            variationId: line.variationId,
            parentLineId: line.id,
            quantity,
            // Prices are the parent's — a return is valued at what was paid, never re-quoted.
            ppWithoutDiscount: line.ppWithoutDiscount,
            discountPercent: line.discountPercent,
            purchasePrice: line.purchasePrice,
            itemTax: line.itemTax,
            purchasePriceIncTax: line.purchasePriceIncTax,
            taxRateId: line.taxRateId,
            lotNumber: line.lotNumber,
            mfgDate: line.mfgDate,
            expDate: line.expDate,
            subUnitId: line.subUnitId,
          },
          lineTotal: round4(quantity * Number(line.purchasePriceIncTax)),
        };
      });

    if (rows.length === 0) throw new BadRequestException('Return at least one line');

    const lineSubtotal = round4(rows.reduce((s, r) => s + r.lineTotal, 0));
    const taxAmount = round4((taxPercent / 100) * lineSubtotal);
    return { rows, lineSubtotal, taxAmount, finalTotal: round4(lineSubtotal + taxAmount) };
  }

  private async taxPercentOf(businessId: number, taxRateId?: number): Promise<number> {
    if (!taxRateId) return 0;
    const tax = await this.prisma.taxRate.findFirst({
      where: { id: taxRateId, businessId, deletedAt: null },
      select: { amount: true },
    });
    if (!tax) throw new BadRequestException('Selected tax rate is invalid');
    return Number(tax.amount);
  }

  // ── writes ────────────────────────────────────────────

  async create(user: AccessPayload, dto: SavePurchaseReturnDto) {
    const businessId = user.businessId as number;
    const parent = await this.loadParent(businessId, dto.purchase_id);
    const taxPercent = await this.taxPercentOf(businessId, dto.tax_rate_id);
    const built = this.build(parent, dto, taxPercent);

    const refNo = dto.ref_no?.trim() || (await this.refs.generate(businessId, 'purchase_return', 'PRET'));
    const clash = await this.prisma.transaction.findFirst({ where: { businessId, refNo }, select: { id: true } });
    if (clash) throw new ConflictException(`Reference number "${refNo}" is already used`);

    const posted = this.postedStock(parent.status, parent.isApproved);

    const id = await this.prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          businessId,
          locationId: parent.locationId,
          contactId: parent.contactId,
          type: 'PURCHASE_RETURN',
          // A return has no workflow — it has happened or it does not exist.
          status: 'FINAL',
          refNo,
          transactionDate: new Date(dto.transaction_date),
          returnParentId: parent.id,
          taxRateId: dto.tax_rate_id ?? null,
          taxAmount: built.taxAmount,
          lineSubtotal: built.lineSubtotal,
          finalTotal: built.finalTotal,
          paymentStatus: 'DUE',
          additionalNotes: dto.additional_notes ?? null,
          createdBy: user.sub,
          purchaseLines: { create: built.rows.map((r) => r.data) },
        },
        select: { id: true },
      });

      for (const r of built.rows) {
        await tx.purchaseLine.update({
          where: { id: r.parentLineId },
          data: { quantityReturned: { increment: r.data.quantity } },
        });
      }

      if (posted) {
        const movements: StockMovement[] = built.rows.map((r) => ({
          locationId: parent.locationId,
          productId: r.productId,
          productVariationId: r.productVariationId,
          variationId: r.variationId,
          delta: -r.data.quantity,
        }));
        await this.stock.moveMany(tx, movements);
      }

      return created.id;
    });

    await this.audit.record({
      model: 'PurchaseReturn',
      subjectId: id,
      name: refNo,
      action: 'created',
      after: {
          refNo,
          parent: parent.refNo,
          finalTotal: built.finalTotal,
          stockReversed: posted,
        },
    });

    return this.findOne(businessId, id);
  }

  async update(user: AccessPayload, id: number, dto: SavePurchaseReturnDto) {
    const businessId = user.businessId as number;
    const existing = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'PURCHASE_RETURN' },
      include: { purchaseLines: true, payments: { select: { amount: true } } },
    });
    if (!existing) throw new NotFoundException('Purchase return not found');
    if (existing.returnParentId !== dto.purchase_id) {
      throw new BadRequestException('A return cannot be moved to a different purchase');
    }

    const parent = await this.loadParent(businessId, dto.purchase_id);
    const taxPercent = await this.taxPercentOf(businessId, dto.tax_rate_id);

    // Measure the new request against the parent MINUS what this return already contributes.
    const own = new Map<number, number>();
    for (const l of existing.purchaseLines) {
      if (l.parentLineId) own.set(l.parentLineId, (own.get(l.parentLineId) ?? 0) + Number(l.quantity));
    }
    const built = this.build(parent, dto, taxPercent, own);
    const posted = this.postedStock(parent.status, parent.isApproved);

    const paid = existing.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    if (paid - built.finalTotal > EPSILON) {
      throw new ConflictException(
        `This return has already been refunded ${paid} — reduce the refund before lowering the total`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Give the parent back everything this return took, then take the new amounts.
      for (const [parentLineId, qty] of own) {
        await tx.purchaseLine.update({
          where: { id: parentLineId },
          data: { quantityReturned: { decrement: qty } },
        });
      }
      await tx.purchaseLine.deleteMany({ where: { transactionId: id } });

      await tx.purchaseLine.createMany({
        data: built.rows.map((r) => ({ transactionId: id, ...r.data })),
      });
      for (const r of built.rows) {
        await tx.purchaseLine.update({
          where: { id: r.parentLineId },
          data: { quantityReturned: { increment: r.data.quantity } },
        });
      }

      if (posted) {
        // Stock moves by the DIFFERENCE, so an unchanged line costs nothing.
        const before = new Map<number, number>();
        for (const l of existing.purchaseLines) {
          before.set(l.variationId, (before.get(l.variationId) ?? 0) + Number(l.quantity));
        }
        const after = new Map<number, number>();
        for (const r of built.rows) {
          after.set(r.variationId, (after.get(r.variationId) ?? 0) + r.data.quantity);
        }
        const meta = new Map(built.rows.map((r) => [r.variationId, r]));
        const movements: StockMovement[] = [];
        for (const variationId of new Set([...before.keys(), ...after.keys()])) {
          const delta = round4((after.get(variationId) ?? 0) - (before.get(variationId) ?? 0));
          if (!delta) continue;
          const row = meta.get(variationId) ?? existing.purchaseLines.find((l) => l.variationId === variationId);
          if (!row) continue;
          const variation = await tx.variation.findUnique({
            where: { id: variationId },
            select: { productId: true, productVariationId: true },
          });
          if (!variation) continue;
          movements.push({
            locationId: parent.locationId,
            productId: variation.productId,
            productVariationId: variation.productVariationId,
            variationId,
            // More returned means less on hand.
            delta: -delta,
          });
        }
        await this.stock.moveMany(tx, movements);
      }

      await tx.transaction.update({
        where: { id },
        data: {
          transactionDate: new Date(dto.transaction_date),
          taxRateId: dto.tax_rate_id ?? null,
          taxAmount: built.taxAmount,
          lineSubtotal: built.lineSubtotal,
          finalTotal: built.finalTotal,
          paymentStatus: paymentStatusFor(built.finalTotal, paid),
          additionalNotes: dto.additional_notes ?? null,
        },
      });
    });

    await this.audit.record({
      model: 'PurchaseReturn',
      subjectId: id,
      name: existing.refNo,
      action: 'updated',
      before: { finalTotal: Number(existing.finalTotal) },
      after: { finalTotal: built.finalTotal },
    });

    return this.findOne(businessId, id);
  }

  async remove(user: AccessPayload, id: number) {
    const businessId = user.businessId as number;
    const existing = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'PURCHASE_RETURN' },
      include: {
        purchaseLines: { include: { variation: { select: { productVariationId: true } } } },
        returnParent: { select: { id: true, status: true, isApproved: true, refNo: true } },
      },
    });
    if (!existing) throw new NotFoundException('Purchase return not found');

    const posted = existing.returnParent
      ? this.postedStock(existing.returnParent.status, existing.returnParent.isApproved)
      : false;

    await this.prisma.$transaction(async (tx) => {
      for (const l of existing.purchaseLines) {
        if (l.parentLineId) {
          await tx.purchaseLine.update({
            where: { id: l.parentLineId },
            data: { quantityReturned: { decrement: Number(l.quantity) } },
          });
        }
      }

      if (posted) {
        // Undoing the return puts the goods back on the shelf.
        await this.stock.moveMany(
          tx,
          existing.purchaseLines.map((l) => ({
            locationId: existing.locationId,
            productId: l.productId,
            productVariationId: l.variation.productVariationId,
            variationId: l.variationId,
            delta: Number(l.quantity),
          })),
        );
      }

      await tx.transaction.delete({ where: { id } });
    });

    await this.audit.record({
      model: 'PurchaseReturn',
      subjectId: id,
      name: existing.refNo,
      action: 'deleted',
      after: { refNo: existing.refNo, finalTotal: Number(existing.finalTotal) },
    });
    return { success: true, msg: 'Purchase return deleted' };
  }

  // ── refunds ───────────────────────────────────────────

  async addPayment(user: AccessPayload, id: number, dto: SaveReturnPaymentDto) {
    const businessId = user.businessId as number;
    const ret = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'PURCHASE_RETURN' },
      include: { payments: { select: { amount: true } } },
    });
    if (!ret) throw new NotFoundException('Purchase return not found');

    const paid = ret.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const due = round4(Number(ret.finalTotal) - paid);
    if (Number(dto.amount) - due > EPSILON) {
      throw new BadRequestException(`Only ${due} is still to be refunded on this return`);
    }

    const refNo = await this.refs.generate(businessId, 'purchase_payment', 'PP');
    await this.prisma.$transaction(async (tx) => {
      await tx.transactionPayment.create({
        data: {
          businessId,
          transactionId: id,
          paymentFor: ret.contactId,
          amount: round4(Number(dto.amount)),
          method: dto.method,
          accountId: dto.account_id ?? null,
          paymentRefNo: refNo,
          paidOn: dto.paid_on ? new Date(dto.paid_on) : new Date(),
          cardTransactionNumber: dto.card_transaction_number ?? null,
          cardHolderName: dto.card_holder_name ?? null,
          cardType: dto.card_type ?? null,
          chequeNumber: dto.cheque_number ?? null,
          bankAccountNumber: dto.bank_account_number ?? null,
          transactionNo: dto.transaction_no ?? null,
          note: dto.note ?? null,
          createdBy: user.sub,
        },
      });
      await tx.transaction.update({
        where: { id },
        data: { paymentStatus: paymentStatusFor(Number(ret.finalTotal), paid + Number(dto.amount)) },
      });
    });

    await this.audit.record({
      model: 'PurchaseReturn',
      subjectId: id,
      name: ret.refNo,
      action: 'updated',
      after: { refund: Number(dto.amount), method: dto.method },
    });
    return this.findOne(businessId, id);
  }

  async removePayment(user: AccessPayload, paymentId: number) {
    const businessId = user.businessId as number;
    const payment = await this.prisma.transactionPayment.findFirst({
      where: { id: paymentId, businessId, transaction: { type: 'PURCHASE_RETURN' } },
      include: { transaction: { select: { id: true, refNo: true, finalTotal: true } } },
    });
    if (!payment) throw new NotFoundException('Refund not found');
    // The relation is optional in the schema (a payment can stand alone), but the `where` above
    // already required a PURCHASE_RETURN parent, so this is a type narrowing, not a real branch.
    const ret = payment.transaction;
    if (!ret) throw new NotFoundException('Refund not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.transactionPayment.delete({ where: { id: paymentId } });
      const rest = await tx.transactionPayment.aggregate({
        where: { transactionId: ret.id },
        _sum: { amount: true },
      });
      await tx.transaction.update({
        where: { id: ret.id },
        data: {
          paymentStatus: paymentStatusFor(Number(ret.finalTotal), Number(rest._sum.amount ?? 0)),
        },
      });
    });

    await this.audit.record({
      model: 'PurchaseReturn',
      subjectId: ret.id,
      name: ret.refNo,
      action: 'updated',
      after: { refundDeleted: Number(payment.amount) },
    });
    return { success: true, msg: 'Refund deleted' };
  }

  // ── reads ─────────────────────────────────────────────

  async list(user: AccessPayload, query: PurchaseReturnsQueryDto) {
    const businessId = user.businessId as number;
    const s = query.search.trim();

    const and: Prisma.TransactionWhereInput[] = [{ businessId, type: 'PURCHASE_RETURN' }];
    if (query.locationId) and.push({ locationId: query.locationId });
    if (query.contactId) and.push({ contactId: query.contactId });
    if (query.paymentStatus) {
      and.push({ paymentStatus: query.paymentStatus.toUpperCase() as 'PAID' | 'DUE' | 'PARTIAL' });
    }
    if (query.dateFrom || query.dateTo) {
      and.push({
        transactionDate: {
          ...(query.dateFrom ? { gte: query.dateFrom } : {}),
          ...(query.dateTo ? { lte: endOfDay(query.dateTo) } : {}),
        },
      });
    }
    if (s) {
      and.push({
        OR: [
          { refNo: { contains: s, mode: 'insensitive' } },
          { returnParent: { refNo: { contains: s, mode: 'insensitive' } } },
          { contact: { name: { contains: s, mode: 'insensitive' } } },
          { contact: { supplierBusinessName: { contains: s, mode: 'insensitive' } } },
        ],
      });
    }
    if (!(await this.ability.can(user, 'purchase.view'))) and.push({ createdBy: user.sub });

    const where: Prisma.TransactionWhereInput = { AND: and };
    const [rows, total, totals] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { transactionDate: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          contact: { select: { name: true, supplierBusinessName: true } },
          location: { select: { name: true } },
          returnParent: { select: { id: true, refNo: true } },
          payments: { select: { amount: true } },
          _count: { select: { purchaseLines: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.aggregate({ where, _sum: { finalTotal: true } }),
    ]);

    const data = rows.map((r) => {
      const paid = r.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      return {
        id: r.id,
        refNo: r.refNo,
        transactionDate: r.transactionDate,
        parentPurchase: r.returnParent ? { id: r.returnParent.id, refNo: r.returnParent.refNo } : null,
        supplier: r.contact?.supplierBusinessName || r.contact?.name || '',
        location: r.location.name,
        // On a return "paid" means the supplier has refunded us — the list says so.
        paymentStatus: r.paymentStatus.toLowerCase(),
        finalTotal: Number(r.finalTotal),
        refunded: round4(paid),
        due: round4(Number(r.finalTotal) - paid),
        items: r._count.purchaseLines,
      };
    });

    return {
      data,
      total,
      totals: {
        finalTotal: round4(Number(totals._sum.finalTotal ?? 0)),
        due: round4(data.reduce((sum, r) => sum + r.due, 0)),
      },
    };
  }

  async findOne(businessId: number, id: number) {
    const r = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'PURCHASE_RETURN' },
      include: {
        contact: { select: { id: true, name: true, supplierBusinessName: true, mobile: true } },
        location: { select: { id: true, name: true } },
        taxRate: { select: { id: true, name: true, amount: true } },
        returnParent: { select: { id: true, refNo: true, transactionDate: true } },
        payments: { orderBy: { paidOn: 'asc' } },
        purchaseLines: {
          orderBy: { id: 'asc' },
          include: {
            product: { select: { id: true, name: true } },
            variation: { select: { id: true, name: true, subSku: true } },
          },
        },
      },
    });
    if (!r) throw new NotFoundException('Purchase return not found');

    const paid = r.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    return {
      id: r.id,
      refNo: r.refNo,
      transactionDate: r.transactionDate,
      paymentStatus: r.paymentStatus.toLowerCase(),
      purchaseId: r.returnParentId,
      parentPurchase: r.returnParent,
      contactId: r.contactId,
      supplier: r.contact
        ? { id: r.contact.id, name: r.contact.supplierBusinessName || r.contact.name || '', mobile: r.contact.mobile }
        : null,
      locationId: r.locationId,
      location: r.location.name,
      lineSubtotal: Number(r.lineSubtotal),
      taxRateId: r.taxRateId,
      tax: r.taxRate ? { id: r.taxRate.id, name: r.taxRate.name, amount: Number(r.taxRate.amount) } : null,
      taxAmount: Number(r.taxAmount),
      finalTotal: Number(r.finalTotal),
      refunded: round4(paid),
      due: round4(Number(r.finalTotal) - paid),
      additionalNotes: r.additionalNotes ?? '',
      lines: r.purchaseLines.map((l) => ({
        id: l.id,
        parentLineId: l.parentLineId,
        productId: l.productId,
        variationId: l.variationId,
        product: l.product.name,
        variation: l.variation.name === 'DUMMY' ? '' : l.variation.name,
        sku: l.variation.subSku ?? '',
        quantity: Number(l.quantity),
        purchasePriceIncTax: Number(l.purchasePriceIncTax),
        lineTotal: round4(Number(l.quantity) * Number(l.purchasePriceIncTax)),
        lotNumber: l.lotNumber ?? '',
      })),
      payments: r.payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        method: p.method,
        paymentRefNo: p.paymentRefNo,
        paidOn: p.paidOn,
        note: p.note ?? '',
      })),
    };
  }

  /**
   * A purchase with, per line, how much is still returnable — what the return form opens with.
   * GOURI computes this cap in the browser only; the server accepts anything.
   */
  async returnableFor(businessId: number, purchaseId: number, excludeReturnId?: number) {
    const parent = await this.loadParent(businessId, purchaseId);

    const own = new Map<number, number>();
    if (excludeReturnId) {
      const lines = await this.prisma.purchaseLine.findMany({
        where: { transactionId: excludeReturnId, transaction: { businessId, type: 'PURCHASE_RETURN' } },
        select: { parentLineId: true, quantity: true },
      });
      for (const l of lines) {
        if (l.parentLineId) own.set(l.parentLineId, (own.get(l.parentLineId) ?? 0) + Number(l.quantity));
      }
    }

    return {
      purchase: {
        id: parent.id,
        refNo: parent.refNo,
        transactionDate: parent.transactionDate,
        locationId: parent.locationId,
        contactId: parent.contactId,
        /** False when the purchase never posted stock — the return then moves no stock either. */
        postedStock: this.postedStock(parent.status, parent.isApproved),
      },
      lines: parent.purchaseLines.map((l) => ({
        parentLineId: l.id,
        productId: l.productId,
        variationId: l.variationId,
        product: l.product.name,
        sku: '',
        quantity: Number(l.quantity),
        quantitySold: Number(l.quantitySold),
        quantityAdjusted: Number(l.quantityAdjusted),
        quantityReturned: Number(l.quantityReturned),
        alreadyOnThisReturn: own.get(l.id) ?? 0,
        returnable: this.returnable(l, own.get(l.id) ?? 0),
        purchasePriceIncTax: Number(l.purchasePriceIncTax),
      })),
    };
  }

  /** Purchases for a supplier that still have something returnable. */
  async returnablePurchases(businessId: number, contactId: number) {
    const rows = await this.prisma.transaction.findMany({
      where: { businessId, type: 'PURCHASE', contactId },
      orderBy: { transactionDate: 'desc' },
      take: 100,
      include: {
        location: { select: { name: true } },
        purchaseLines: {
          select: { quantity: true, quantitySold: true, quantityAdjusted: true, quantityReturned: true },
        },
      },
    });

    return {
      data: rows
        .map((r) => ({
          id: r.id,
          refNo: r.refNo,
          transactionDate: r.transactionDate,
          location: r.location.name,
          finalTotal: Number(r.finalTotal),
          returnable: round4(r.purchaseLines.reduce((sum, l) => sum + this.returnable(l), 0)),
        }))
        .filter((r) => r.returnable > 0),
    };
  }
}
