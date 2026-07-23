import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { AbilityService } from '../../common/services/ability.service';
import { ReferenceNumberService } from '../../common/services/reference-number.service';
import { StockService, type StockMovement } from '../../common/services/stock.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../auth/token.service';
import { paymentStatusFor } from '../purchases/purchase.calc';
import { returnSellLineQuantity } from '../sells/fifo';
import { calcSellTotals, round4 } from '../sells/sell.calc';
import type { SaveRefundDto, SaveSellReturnDto, SellReturnsQueryDto } from './dto/sell-return.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);
const upper = <T extends string>(v: T) => v.toUpperCase() as Uppercase<T>;
const endOfDay = (d: Date) => new Date(new Date(d).setHours(23, 59, 59, 999));
const EPSILON = 0.00005;

/**
 * Sell returns — goods a customer sends back. The sell-side mirror of a purchase return:
 *  - a return is its own document, each line pointing at the sell line it reverses;
 *  - it PUTS stock back and frees the exact purchase lots the sale consumed (decrementing their
 *    `quantity_sold` through the FIFO allocations), so the returned units are resaleable;
 *  - `quantity_returned` on the parent sell line is an atomic increment, capped at what is still
 *    returnable — GOURI caps only in the browser.
 * Stock only moves if the parent sale was FINAL (a draft never issued any).
 */
@Injectable()
export class SellReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly refs: ReferenceNumberService,
    private readonly audit: AuditService,
    private readonly ability: AbilityService,
  ) {}

  private returnable(line: { quantity: unknown; quantityReturned: unknown }, own = 0): number {
    return round4(Number(line.quantity) - (Number(line.quantityReturned) - own));
  }

  private async loadParent(businessId: number, sellId: number) {
    const parent = await this.prisma.transaction.findFirst({
      where: { id: sellId, businessId, type: 'SELL' },
      include: {
        sellLines: {
          include: { product: { select: { id: true, name: true } }, variation: { select: { id: true, productVariationId: true } } },
        },
      },
    });
    if (!parent) throw new BadRequestException('The sale being returned does not exist');
    return parent;
  }

  private build(
    parent: Awaited<ReturnType<typeof this.loadParent>>,
    dto: SaveSellReturnDto,
    taxPercent: number,
    existingByParent = new Map<number, number>(),
  ) {
    const parentLines = new Map(parent.sellLines.map((l) => [l.id, l]));
    const rows = dto.returns
      .filter((r) => Number(r.quantity) > 0)
      .map((r) => {
        const line = parentLines.get(r.parent_line_id);
        if (!line) throw new BadRequestException('One or more lines do not belong to that sale');
        const quantity = round4(Number(r.quantity));
        const allowed = this.returnable(line, existingByParent.get(line.id) ?? 0);
        if (quantity - allowed > EPSILON) {
          throw new BadRequestException(`Only ${allowed} of "${line.product.name}" can be returned`);
        }
        return {
          parentLineId: line.id,
          productId: line.productId,
          variationId: line.variationId,
          productVariationId: line.variation.productVariationId,
          data: {
            productId: line.productId,
            variationId: line.variationId,
            parentSellLineId: line.id,
            quantity,
            unitPrice: line.unitPrice,
            unitPriceBeforeDiscount: line.unitPriceBeforeDiscount,
            lineDiscountType: line.lineDiscountType,
            lineDiscountAmount: line.lineDiscountAmount,
            itemTax: line.itemTax,
            unitPriceIncTax: line.unitPriceIncTax,
            taxRateId: line.taxRateId,
            subUnitId: line.subUnitId,
          },
          lineTotal: round4(quantity * Number(line.unitPriceIncTax)),
        };
      });
    if (rows.length === 0) throw new BadRequestException('Return at least one line');

    // The returned line totals are ALREADY tax-inclusive (a sell line stores `unit_price_inc_tax`),
    // so we credit exactly what was billed minus any return discount — adding order tax again would
    // double-count it (the sell-side `total_before_tax` trap the port fixes).
    const totals = calcSellTotals({
      lineSubtotal: rows.reduce((s, r) => s + r.lineTotal, 0),
      discountType: dto.discount_type,
      discountAmount: Number(dto.discount_amount) || 0,
      orderTaxPercent: 0,
      shippingCharges: 0,
    });
    return { rows, ...totals };
  }

  private async taxPercentOf(businessId: number, taxRateId?: number): Promise<number> {
    if (!taxRateId) return 0;
    const tax = await this.prisma.taxRate.findFirst({ where: { id: taxRateId, businessId, deletedAt: null }, select: { amount: true } });
    if (!tax) throw new BadRequestException('Selected tax rate is invalid');
    return Number(tax.amount);
  }

  // ── writes ────────────────────────────────────────────
  async create(user: AccessPayload, dto: SaveSellReturnDto) {
    const businessId = user.businessId as number;
    const parent = await this.loadParent(businessId, dto.sell_id);
    const taxPercent = await this.taxPercentOf(businessId, dto.tax_rate_id);
    const built = this.build(parent, dto, taxPercent);

    const refNo = dto.ref_no?.trim() || (await this.refs.generate(businessId, 'sell_return', 'SRET'));
    const clash = await this.prisma.transaction.findFirst({ where: { businessId, refNo }, select: { id: true } });
    if (clash) throw new ConflictException(`Reference number "${refNo}" is already used`);

    const posted = parent.status === 'FINAL';
    const id = await this.prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          businessId,
          locationId: parent.locationId,
          contactId: parent.contactId,
          type: 'SELL_RETURN',
          status: 'FINAL',
          refNo,
          transactionDate: new Date(dto.transaction_date),
          returnParentId: parent.id,
          taxRateId: dto.tax_rate_id ?? null,
          taxAmount: built.taxAmount,
          discountType: dto.discount_type ? upper(dto.discount_type) : null,
          discountAmount: Number(dto.discount_amount) || 0,
          lineSubtotal: built.lineSubtotal,
          finalTotal: built.finalTotal,
          paymentStatus: 'DUE',
          additionalNotes: blank(dto.additional_notes),
          createdBy: user.sub,
          sellLines: { create: built.rows.map((r) => r.data) },
        },
        select: { id: true },
      });

      const movements: StockMovement[] = [];
      for (const r of built.rows) {
        await tx.transactionSellLine.update({ where: { id: r.parentLineId }, data: { quantityReturned: { increment: r.data.quantity } } });
        if (posted) {
          // Free the lots the sale consumed and put the goods back on the shelf.
          await returnSellLineQuantity(tx, r.parentLineId, r.data.quantity);
          movements.push({
            locationId: parent.locationId,
            productId: r.productId,
            productVariationId: r.productVariationId,
            variationId: r.variationId,
            delta: r.data.quantity,
          });
        }
      }
      await this.stock.moveMany(tx, movements);
      return created.id;
    });

    await this.audit.record({
      model: 'SellReturn',
      subjectId: id,
      name: refNo,
      action: 'created',
      after: { refNo, parent: parent.refNo, finalTotal: built.finalTotal, stockRestored: posted },
    });
    return this.findOne(businessId, id);
  }

  async remove(user: AccessPayload, id: number) {
    const businessId = user.businessId as number;
    const existing = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'SELL_RETURN' },
      include: {
        sellLines: { include: { variation: { select: { productVariationId: true } } } },
        returnParent: { select: { status: true } },
      },
    });
    if (!existing) throw new NotFoundException('Sell return not found');
    const posted = existing.returnParent?.status === 'FINAL';

    await this.prisma.$transaction(async (tx) => {
      const movements: StockMovement[] = [];
      for (const l of existing.sellLines) {
        if (l.parentSellLineId) {
          await tx.transactionSellLine.update({ where: { id: l.parentSellLineId }, data: { quantityReturned: { decrement: Number(l.quantity) } } });
          if (posted) {
            // Re-consume the lots (undo the return's freeing) and take the goods back off the shelf.
            await this.reconsume(tx, l.parentSellLineId, Number(l.quantity));
            movements.push({
              locationId: existing.locationId,
              productId: l.productId,
              productVariationId: l.variation.productVariationId,
              variationId: l.variationId,
              delta: -Number(l.quantity),
            });
          }
        }
      }
      await this.stock.moveMany(tx, movements);
      await tx.transaction.delete({ where: { id } });
    });

    await this.audit.record({ model: 'SellReturn', subjectId: id, name: existing.refNo, action: 'deleted', after: { refNo: existing.refNo } });
    return { success: true, msg: 'Sell return deleted' };
  }

  /** Undo a return's lot-freeing: re-mark `quantity` as sold across the sell line's allocations. */
  private async reconsume(tx: Prisma.TransactionClient, sellLineId: number, quantity: number) {
    let remaining = round4(quantity);
    const allocations = await tx.sellPurchaseAllocation.findMany({
      where: { sellLineId },
      select: { id: true, purchaseLineId: true, qtyReturned: true },
      orderBy: { id: 'asc' },
    });
    for (const a of allocations) {
      if (remaining <= EPSILON) break;
      const take = Math.min(remaining, Number(a.qtyReturned));
      if (take <= EPSILON) continue;
      await tx.sellPurchaseAllocation.update({ where: { id: a.id }, data: { qtyReturned: { decrement: round4(take) } } });
      await tx.purchaseLine.update({ where: { id: a.purchaseLineId }, data: { quantitySold: { increment: round4(take) } } });
      remaining = round4(remaining - take);
    }
  }

  // ── refunds ───────────────────────────────────────────
  async addRefund(user: AccessPayload, id: number, dto: SaveRefundDto) {
    const businessId = user.businessId as number;
    const ret = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'SELL_RETURN' },
      include: { payments: { select: { amount: true } } },
    });
    if (!ret) throw new NotFoundException('Sell return not found');
    const paid = ret.payments.reduce((s, p) => s + Number(p.amount), 0);
    const due = round4(Number(ret.finalTotal) - paid);
    if (Number(dto.amount) - due > EPSILON) throw new BadRequestException(`Only ${due} is still to be refunded`);

    const refNo = await this.refs.generate(businessId, 'sell_payment', 'PP');
    await this.prisma.$transaction(async (tx) => {
      await tx.transactionPayment.create({
        data: {
          businessId,
          transactionId: id,
          paymentFor: ret.contactId,
          amount: round4(Number(dto.amount)),
          method: dto.method,
          accountId: dto.account_id ?? null,
          isReturn: true,
          paymentRefNo: refNo,
          paidOn: dto.paid_on ? new Date(dto.paid_on) : new Date(),
          chequeNumber: dto.cheque_number ?? null,
          bankAccountNumber: dto.bank_account_number ?? null,
          transactionNo: dto.transaction_no ?? null,
          note: dto.note ?? null,
          createdBy: user.sub,
        },
      });
      await tx.transaction.update({ where: { id }, data: { paymentStatus: paymentStatusFor(Number(ret.finalTotal), paid + Number(dto.amount)) } });
    });
    await this.audit.record({ model: 'SellReturn', subjectId: id, name: ret.refNo, action: 'updated', after: { refund: Number(dto.amount), method: dto.method } });
    return this.findOne(businessId, id);
  }

  async removeRefund(user: AccessPayload, paymentId: number) {
    const businessId = user.businessId as number;
    const payment = await this.prisma.transactionPayment.findFirst({
      where: { id: paymentId, businessId, transaction: { type: 'SELL_RETURN' } },
      include: { transaction: { select: { id: true, refNo: true, finalTotal: true } } },
    });
    if (!payment?.transaction) throw new NotFoundException('Refund not found');
    const ret = payment.transaction;
    await this.prisma.$transaction(async (tx) => {
      await tx.transactionPayment.delete({ where: { id: paymentId } });
      const rest = await tx.transactionPayment.aggregate({ where: { transactionId: ret.id }, _sum: { amount: true } });
      await tx.transaction.update({ where: { id: ret.id }, data: { paymentStatus: paymentStatusFor(Number(ret.finalTotal), Number(rest._sum.amount ?? 0)) } });
    });
    await this.audit.record({ model: 'SellReturn', subjectId: ret.id, name: ret.refNo, action: 'updated', after: { refundDeleted: Number(payment.amount) } });
    return { success: true, msg: 'Refund deleted' };
  }

  // ── reads ─────────────────────────────────────────────
  async list(user: AccessPayload, query: SellReturnsQueryDto) {
    const businessId = user.businessId as number;
    const s = query.search.trim();
    const and: Prisma.TransactionWhereInput[] = [{ businessId, type: 'SELL_RETURN' }];
    if (query.locationId) and.push({ locationId: query.locationId });
    if (query.contactId) and.push({ contactId: query.contactId });
    if (query.paymentStatus) and.push({ paymentStatus: query.paymentStatus.toUpperCase() as 'PAID' | 'DUE' | 'PARTIAL' });
    if (query.dateFrom || query.dateTo) {
      and.push({ transactionDate: { ...(query.dateFrom ? { gte: query.dateFrom } : {}), ...(query.dateTo ? { lte: endOfDay(query.dateTo) } : {}) } });
    }
    if (s) {
      and.push({
        OR: [
          { refNo: { contains: s, mode: 'insensitive' } },
          { returnParent: { refNo: { contains: s, mode: 'insensitive' } } },
          { contact: { name: { contains: s, mode: 'insensitive' } } },
        ],
      });
    }
    if (!(await this.ability.can(user, 'access_sell_return'))) and.push({ createdBy: user.sub });

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
          _count: { select: { sellLines: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.aggregate({ where, _sum: { finalTotal: true } }),
    ]);

    const data = rows.map((r) => {
      const paid = r.payments.reduce((s2, p) => s2 + Number(p.amount), 0);
      return {
        id: r.id,
        refNo: r.refNo,
        transactionDate: r.transactionDate,
        parentSell: r.returnParent ? { id: r.returnParent.id, refNo: r.returnParent.refNo } : null,
        customer: r.contact?.name || r.contact?.supplierBusinessName || '',
        location: r.location.name,
        paymentStatus: r.paymentStatus.toLowerCase(),
        finalTotal: Number(r.finalTotal),
        refunded: round4(paid),
        due: round4(Number(r.finalTotal) - paid),
        items: r._count.sellLines,
      };
    });
    return { data, total, totals: { finalTotal: round4(Number(totals._sum.finalTotal ?? 0)), due: round4(data.reduce((s2, r) => s2 + r.due, 0)) } };
  }

  async findOne(businessId: number, id: number) {
    const r = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'SELL_RETURN' },
      include: {
        contact: { select: { id: true, name: true, supplierBusinessName: true, mobile: true } },
        location: { select: { id: true, name: true } },
        taxRate: { select: { id: true, name: true, amount: true } },
        returnParent: { select: { id: true, refNo: true, transactionDate: true } },
        payments: { orderBy: { paidOn: 'asc' } },
        sellLines: {
          orderBy: { id: 'asc' },
          include: { product: { select: { id: true, name: true } }, variation: { select: { id: true, name: true, subSku: true } } },
        },
      },
    });
    if (!r) throw new NotFoundException('Sell return not found');
    const paid = r.payments.reduce((s, p) => s + Number(p.amount), 0);
    return {
      id: r.id,
      refNo: r.refNo,
      transactionDate: r.transactionDate,
      paymentStatus: r.paymentStatus.toLowerCase(),
      sellId: r.returnParentId,
      parentSell: r.returnParent,
      contactId: r.contactId,
      customer: r.contact ? { id: r.contact.id, name: r.contact.name || r.contact.supplierBusinessName || '', mobile: r.contact.mobile } : null,
      locationId: r.locationId,
      location: r.location.name,
      lineSubtotal: Number(r.lineSubtotal),
      taxRateId: r.taxRateId,
      tax: r.taxRate ? { id: r.taxRate.id, name: r.taxRate.name, amount: Number(r.taxRate.amount) } : null,
      taxAmount: Number(r.taxAmount),
      discountType: r.discountType?.toLowerCase() ?? null,
      discountAmount: Number(r.discountAmount),
      finalTotal: Number(r.finalTotal),
      refunded: round4(paid),
      due: round4(Number(r.finalTotal) - paid),
      additionalNotes: r.additionalNotes ?? '',
      lines: r.sellLines.map((l) => ({
        id: l.id,
        parentLineId: l.parentSellLineId,
        productId: l.productId,
        variationId: l.variationId,
        product: l.product.name,
        variation: l.variation.name === 'DUMMY' ? '' : l.variation.name,
        sku: l.variation.subSku ?? '',
        quantity: Number(l.quantity),
        unitPriceIncTax: Number(l.unitPriceIncTax),
        lineTotal: round4(Number(l.quantity) * Number(l.unitPriceIncTax)),
      })),
      payments: r.payments.map((p) => ({ id: p.id, amount: Number(p.amount), method: p.method, paymentRefNo: p.paymentRefNo, paidOn: p.paidOn, note: p.note ?? '' })),
    };
  }

  /** A sale with, per line, how much is still returnable — what the return form opens with. */
  async returnableFor(businessId: number, sellId: number, excludeReturnId?: number) {
    const parent = await this.loadParent(businessId, sellId);
    const own = new Map<number, number>();
    if (excludeReturnId) {
      const lines = await this.prisma.transactionSellLine.findMany({
        where: { transactionId: excludeReturnId, transaction: { businessId, type: 'SELL_RETURN' } },
        select: { parentSellLineId: true, quantity: true },
      });
      for (const l of lines) if (l.parentSellLineId) own.set(l.parentSellLineId, (own.get(l.parentSellLineId) ?? 0) + Number(l.quantity));
    }
    return {
      sale: { id: parent.id, refNo: parent.refNo, transactionDate: parent.transactionDate, locationId: parent.locationId, contactId: parent.contactId, postedStock: parent.status === 'FINAL' },
      lines: parent.sellLines.map((l) => ({
        parentLineId: l.id,
        productId: l.productId,
        variationId: l.variationId,
        product: l.product.name,
        quantity: Number(l.quantity),
        quantityReturned: Number(l.quantityReturned),
        alreadyOnThisReturn: own.get(l.id) ?? 0,
        returnable: this.returnable(l, own.get(l.id) ?? 0),
        unitPriceIncTax: Number(l.unitPriceIncTax),
      })),
    };
  }

  /** Final sales for a customer that still have something returnable. */
  async returnableSells(businessId: number, contactId: number) {
    const rows = await this.prisma.transaction.findMany({
      where: { businessId, type: 'SELL', status: 'FINAL', contactId },
      orderBy: { transactionDate: 'desc' },
      take: 100,
      include: { location: { select: { name: true } }, sellLines: { select: { quantity: true, quantityReturned: true } } },
    });
    return {
      data: rows
        .map((r) => ({
          id: r.id,
          refNo: r.refNo,
          transactionDate: r.transactionDate,
          location: r.location.name,
          finalTotal: Number(r.finalTotal),
          returnable: round4(r.sellLines.reduce((s, l) => s + this.returnable(l), 0)),
        }))
        .filter((r) => r.returnable > 0),
    };
  }
}
