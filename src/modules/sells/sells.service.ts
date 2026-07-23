import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { AbilityService } from '../../common/services/ability.service';
import { ReferenceNumberService } from '../../common/services/reference-number.service';
import { StockService, type StockMovement } from '../../common/services/stock.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../auth/token.service';
import { type DrawDown } from '../purchases/draw-down';
import { paymentStatusFor } from '../purchases/purchase.calc';
import { allocateFifo, deallocateSellLine, type AllocationTarget } from './fifo';
import { calcSellLine, calcSellTotals, round4 } from './sell.calc';
import type { SaveSellDto, SavePaymentDto } from './dto/sell.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);
const upper = <T extends string>(v: T) => v.toUpperCase() as Uppercase<T>;
const endOfDay = (d: Date) => new Date(new Date(d).setHours(23, 59, 59, 999));

/**
 * Sells — the mirror of Purchases: a FINAL sell ISSUES stock (and allocates it to purchase lots
 * via FIFO), a DRAFT/quotation touches nothing. The document total is recomputed server-side,
 * unlike GOURI which banks the browser's `final_total`.
 */
@Injectable()
export class SellsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly refs: ReferenceNumberService,
    private readonly audit: AuditService,
    private readonly ability: AbilityService,
  ) {}

  /** Stock is issued only for a FINAL sell. A draft/quotation is just paperwork. */
  private postsStock(status: string): boolean {
    return status === 'FINAL';
  }

  // ── validation + computation ──────────────────────────

  private async assertRefs(businessId: number, dto: SaveSellDto) {
    const [customer, location] = await Promise.all([
      this.prisma.contact.findFirst({
        where: { id: dto.contact_id, businessId, deletedAt: null, type: { in: ['customer', 'both'] } },
        select: { id: true },
      }),
      this.prisma.businessLocation.findFirst({
        where: { id: dto.location_id, businessId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (!customer) throw new BadRequestException('Selected customer is invalid');
    if (!location) throw new BadRequestException('Selected business location is invalid');

    const variationIds = [...new Set(dto.sells.map((l) => l.variation_id))];
    const variations = await this.prisma.variation.findMany({
      where: { id: { in: variationIds }, deletedAt: null, product: { businessId } },
      select: {
        id: true,
        productId: true,
        productVariationId: true,
        defaultSellPrice: true,
        product: { select: { enableStock: true, name: true } },
      },
    });
    if (variations.length !== variationIds.length) {
      throw new BadRequestException('One or more products are invalid');
    }

    const taxIds = [
      ...new Set([dto.tax_rate_id, ...dto.sells.map((l) => l.tax_rate_id)].filter(Boolean) as number[]),
    ];
    if (taxIds.length) {
      const n = await this.prisma.taxRate.count({ where: { id: { in: taxIds }, businessId, deletedAt: null } });
      if (n !== taxIds.length) throw new BadRequestException('One or more tax rates are invalid');
    }

    const subUnitIds = [...new Set(dto.sells.map((l) => l.sub_unit_id).filter(Boolean) as number[])];
    if (subUnitIds.length) {
      const n = await this.prisma.unit.count({ where: { id: { in: subUnitIds }, businessId, deletedAt: null } });
      if (n !== subUnitIds.length) throw new BadRequestException('One or more units are invalid');
    }

    const soLineIds = [...new Set(dto.sells.map((l) => l.so_line_id).filter(Boolean) as number[])];
    if (soLineIds.length) {
      const n = await this.prisma.transactionSellLine.count({
        where: { id: { in: soLineIds }, transaction: { businessId, type: 'SALES_ORDER' } },
      });
      if (n !== soLineIds.length) throw new BadRequestException('One or more sales-order lines are invalid');
    }

    return new Map(variations.map((v) => [v.id, v]));
  }

  /** Recompute every figure from the lines. Nothing monetary is taken from the request. */
  private async build(businessId: number, dto: SaveSellDto) {
    const variations = await this.assertRefs(businessId, dto);

    const taxIds = [
      ...new Set([dto.tax_rate_id, ...dto.sells.map((l) => l.tax_rate_id)].filter(Boolean) as number[]),
    ];
    const taxRates = taxIds.length
      ? await this.prisma.taxRate.findMany({ where: { id: { in: taxIds } }, select: { id: true, amount: true } })
      : [];
    const taxPercent = new Map(taxRates.map((t) => [t.id, Number(t.amount)]));

    const subUnitIds = [...new Set(dto.sells.map((l) => l.sub_unit_id).filter(Boolean) as number[])];
    const subUnits = subUnitIds.length
      ? await this.prisma.unit.findMany({
          where: { id: { in: subUnitIds } },
          select: { id: true, baseUnitMultiplier: true },
        })
      : [];
    const multiplierOf = new Map(subUnits.map((u) => [u.id, Number(u.baseUnitMultiplier ?? 1) || 1]));

    const lines = dto.sells.map((line) => {
      const v = variations.get(line.variation_id)!;
      const multiplier = line.sub_unit_id ? (multiplierOf.get(line.sub_unit_id) ?? 1) : 1;
      // Fall back to the variation's default sell price when the form omits it.
      const unitPrice =
        line.unit_price != null ? Number(line.unit_price) : Number(v.defaultSellPrice ?? 0) * multiplier;
      const calc = calcSellLine({
        quantity: line.quantity,
        unitPrice,
        lineDiscountType: line.line_discount_type,
        lineDiscountAmount: line.line_discount_amount,
        taxPercent: line.tax_rate_id ? (taxPercent.get(line.tax_rate_id) ?? 0) : 0,
        multiplier,
      });

      return {
        input: line,
        productId: v.productId,
        productVariationId: v.productVariationId,
        variationId: line.variation_id,
        enableStock: v.product.enableStock,
        productName: v.product.name,
        baseQuantity: calc.baseQuantity,
        data: {
          productId: v.productId,
          variationId: line.variation_id,
          quantity: calc.baseQuantity,
          subUnitId: line.sub_unit_id ?? null,
          unitPriceBeforeDiscount: calc.unitPriceBeforeDiscount,
          unitPrice: calc.unitPrice,
          lineDiscountType: line.line_discount_type ? upper(line.line_discount_type) : null,
          lineDiscountAmount: calc.lineDiscountAmount,
          itemTax: calc.itemTax,
          unitPriceIncTax: calc.unitPriceIncTax,
          taxRateId: line.tax_rate_id ?? null,
          soLineId: line.so_line_id ?? null,
          note: blank(line.note),
        },
        lineTotal: calc.lineTotal,
      };
    });

    const totals = calcSellTotals({
      lineSubtotal: lines.reduce((s, l) => s + l.lineTotal, 0),
      discountType: dto.discount_type,
      discountAmount: Number(dto.discount_amount) || 0,
      orderTaxPercent: dto.tax_rate_id ? (taxPercent.get(dto.tax_rate_id) ?? 0) : 0,
      shippingCharges: Number(dto.shipping_charges) || 0,
      additionalExpenses: dto.additional_expenses,
      roundOff: Number(dto.round_off_amount) || 0,
    });

    return {
      lines,
      totals,
      money: {
        lineSubtotal: totals.lineSubtotal,
        taxAmount: totals.taxAmount,
        discountAmount: Number(dto.discount_amount) || 0,
        shippingCharges: Number(dto.shipping_charges) || 0,
        finalTotal: totals.finalTotal,
        additionalExpenses: (dto.additional_expenses ?? []).map((e) => ({
          name: e.name,
          amount: round4(Number(e.amount) || 0),
        })),
      },
    };
  }

  private header(dto: SaveSellDto, money: Awaited<ReturnType<typeof this.build>>['money'], status: string) {
    return {
      contactId: dto.contact_id,
      locationId: dto.location_id,
      transactionDate: new Date(dto.transaction_date),
      subStatus: status === 'DRAFT' && dto.sub_status ? upper(dto.sub_status) : null,
      payTermNumber: dto.pay_term_number ?? null,
      payTermType: dto.pay_term_type ? upper(dto.pay_term_type) : null,
      discountType: dto.discount_type ? upper(dto.discount_type) : null,
      discountAmount: money.discountAmount,
      taxRateId: dto.tax_rate_id ?? null,
      taxAmount: money.taxAmount,
      shippingDetails: blank(dto.shipping_details),
      shippingAddress: blank(dto.shipping_address),
      shippingCharges: money.shippingCharges,
      shippingStatus: dto.shipping_status ? upper(dto.shipping_status) : null,
      deliveredTo: blank(dto.delivered_to),
      additionalExpenses: money.additionalExpenses.length ? money.additionalExpenses : Prisma.JsonNull,
      roundOffAmount: Number(dto.round_off_amount) || 0,
      lineSubtotal: money.lineSubtotal,
      finalTotal: money.finalTotal,
      additionalNotes: blank(dto.additional_notes),
      customField1: blank(dto.custom_field_1),
      customField2: blank(dto.custom_field_2),
      customField3: blank(dto.custom_field_3),
      customField4: blank(dto.custom_field_4),
      salesOrderIds: dto.sales_order_ids?.length ? dto.sales_order_ids : Prisma.JsonNull,
    };
  }

  /** Issue stock + FIFO-allocate every stock-tracked line of a final sell. */
  private async postLines(
    tx: Prisma.TransactionClient,
    businessId: number,
    locationId: number,
    lifo: boolean,
    lines: { id: number; productId: number; productVariationId: number; variationId: number; baseQuantity: number; enableStock: boolean; name: string }[],
  ) {
    const movements: StockMovement[] = [];
    for (const l of lines) {
      if (!l.enableStock) continue;
      await allocateFifo(tx, { businessId, locationId, lifo }, {
        sellLineId: l.id,
        productId: l.productId,
        variationId: l.variationId,
        quantity: l.baseQuantity,
        productName: l.name,
      } as AllocationTarget);
      movements.push({
        locationId,
        productId: l.productId,
        productVariationId: l.productVariationId,
        variationId: l.variationId,
        delta: -l.baseQuantity, // a sale reduces on-hand
      });
    }
    await this.stock.moveMany(tx, movements);
  }

  /** Reverse stock + FIFO for a set of existing sell lines (edit/delete of a final sell). */
  private async unpostLines(
    tx: Prisma.TransactionClient,
    locationId: number,
    lines: { id: number; productId: number; variationId: number; quantity: unknown; product: { enableStock: boolean }; variation: { productVariationId: number } }[],
  ) {
    const movements: StockMovement[] = [];
    for (const l of lines) {
      await deallocateSellLine(tx, l.id);
      if (l.product.enableStock) {
        movements.push({
          locationId,
          productId: l.productId,
          productVariationId: l.variation.productVariationId,
          variationId: l.variationId,
          delta: Number(l.quantity), // put it back on the shelf
        });
      }
    }
    await this.stock.moveMany(tx, movements);
  }

  private async accountingMethod(businessId: number): Promise<boolean> {
    const b = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { accountingMethod: true },
    });
    return b?.accountingMethod === 'LIFO';
  }

  // ── writes ────────────────────────────────────────────

  async create(user: AccessPayload, dto: SaveSellDto) {
    const businessId = user.businessId as number;
    const status = upper(dto.status);
    const { lines, money } = await this.build(businessId, dto);
    const lifo = await this.accountingMethod(businessId);

    // Final sells consume the invoice scheme; drafts/quotations get their own ref series.
    const refType = status === 'DRAFT' ? (dto.sub_status ?? 'draft') : 'sell';
    const prefix = status === 'DRAFT' ? (dto.sub_status === 'quotation' ? 'QTN' : 'DRF') : 'INV';
    const refNo = blank(dto.ref_no) ?? (await this.refs.generate(businessId, refType, prefix));
    const clash = await this.prisma.transaction.findFirst({ where: { businessId, refNo }, select: { id: true } });
    if (clash) throw new ConflictException(`Reference number "${refNo}" is already used`);

    const id = await this.prisma.$transaction(
      async (tx) => {
        const sell = await tx.transaction.create({
          data: {
            businessId,
            type: 'SELL',
            status,
            refNo,
            createdBy: user.sub,
            paymentStatus: 'DUE',
            ...this.header(dto, money, status),
          },
          select: { id: true },
        });

        // Create lines first so we have their ids for FIFO allocation.
        const created: { id: number; productId: number; productVariationId: number; variationId: number; baseQuantity: number; enableStock: boolean; name: string }[] = [];
        for (const l of lines) {
          const row = await tx.transactionSellLine.create({
            data: { transactionId: sell.id, ...l.data },
            select: { id: true },
          });
          created.push({
            id: row.id,
            productId: l.productId,
            productVariationId: l.productVariationId,
            variationId: l.variationId,
            baseQuantity: l.baseQuantity,
            enableStock: l.enableStock,
            name: l.productName,
          });
        }

        if (this.postsStock(status)) {
          await this.postLines(tx, businessId, dto.location_id, lifo, created);
        }

        // Draw down any sales orders this sell invoices.
        const draws: DrawDown[] = lines
          .filter((l) => l.data.soLineId)
          .map((l) => ({ lineId: l.data.soLineId as number, delta: l.baseQuantity }));
        if (draws.length) {
          const touched = await this.applySalesOrderDraws(tx, draws);
          await this.recomputeSalesOrderStatus(tx, touched);
        }

        await this.writePayments(tx, businessId, sell.id, user.sub, dto.contact_id, dto.payment ?? []);
        await this.syncPaymentStatus(tx, sell.id, money.finalTotal);
        return sell.id;
      },
      { timeout: 30000 },
    );

    await this.audit.record({
      model: 'Sell',
      subjectId: id,
      name: refNo,
      action: 'created',
      after: { refNo, finalTotal: money.finalTotal, status: dto.status },
    });
    return this.findOne(businessId, id);
  }

  async update(user: AccessPayload, id: number, dto: SaveSellDto) {
    const businessId = user.businessId as number;
    const existing = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'SELL' },
      include: {
        sellLines: { include: { product: { select: { enableStock: true } }, variation: { select: { productVariationId: true } } } },
        returns: { select: { id: true } },
      },
    });
    if (!existing) throw new NotFoundException('Sell not found');
    if (existing.returns.length) {
      throw new BadRequestException('This sale has a return against it and can no longer be edited');
    }

    const status = upper(dto.status);
    const { lines, money } = await this.build(businessId, dto);
    const lifo = await this.accountingMethod(businessId);
    const locationId = existing.locationId; // fixed after creation, like purchases

    if (blank(dto.ref_no) && blank(dto.ref_no) !== existing.refNo) {
      const clash = await this.prisma.transaction.findFirst({
        where: { businessId, refNo: blank(dto.ref_no) as string, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw new ConflictException(`Reference number "${dto.ref_no}" is already used`);
    }

    await this.prisma.$transaction(
      async (tx) => {
        // Give back what the old lines took from their sales orders.
        const giveBack: DrawDown[] = existing.sellLines
          .filter((l) => l.soLineId)
          .map((l) => ({ lineId: l.soLineId as number, delta: -Number(l.quantity) }));

        // Reverse stock + FIFO for the old final lines, then drop them.
        if (this.postsStock(existing.status)) {
          await this.unpostLines(tx, locationId, existing.sellLines);
        } else {
          for (const l of existing.sellLines) await deallocateSellLine(tx, l.id);
        }
        await tx.transactionSellLine.deleteMany({ where: { transactionId: id } });

        // Recreate lines.
        const created: { id: number; productId: number; productVariationId: number; variationId: number; baseQuantity: number; enableStock: boolean; name: string }[] = [];
        for (const l of lines) {
          const row = await tx.transactionSellLine.create({ data: { transactionId: id, ...l.data }, select: { id: true } });
          created.push({ id: row.id, productId: l.productId, productVariationId: l.productVariationId, variationId: l.variationId, baseQuantity: l.baseQuantity, enableStock: l.enableStock, name: l.productName });
        }
        if (this.postsStock(status)) {
          await this.postLines(tx, businessId, locationId, lifo, created);
        }

        const take: DrawDown[] = lines
          .filter((l) => l.data.soLineId)
          .map((l) => ({ lineId: l.data.soLineId as number, delta: l.baseQuantity }));
        const touched = await this.applySalesOrderDraws(tx, [...giveBack, ...take]);

        await tx.transaction.update({
          where: { id },
          data: { refNo: blank(dto.ref_no) ?? existing.refNo, status, ...this.header(dto, money, status) },
        });

        await this.recomputeSalesOrderStatus(tx, touched);
        await this.syncPaymentStatus(tx, id, money.finalTotal);
      },
      { timeout: 30000 },
    );

    await this.audit.record({
      model: 'Sell',
      subjectId: id,
      name: existing.refNo,
      action: 'updated',
      before: { finalTotal: Number(existing.finalTotal) },
      after: { finalTotal: money.finalTotal, status: dto.status },
    });
    return this.findOne(businessId, id);
  }

  async remove(user: AccessPayload, id: number) {
    const businessId = user.businessId as number;
    const sell = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'SELL' },
      include: {
        sellLines: { include: { product: { select: { enableStock: true } }, variation: { select: { productVariationId: true } } } },
        returns: { select: { id: true } },
      },
    });
    if (!sell) throw new NotFoundException('Sell not found');
    if (sell.returns.length) {
      throw new BadRequestException('This sale has a return against it and cannot be deleted');
    }

    await this.prisma.$transaction(async (tx) => {
      const giveBack: DrawDown[] = sell.sellLines
        .filter((l) => l.soLineId)
        .map((l) => ({ lineId: l.soLineId as number, delta: -Number(l.quantity) }));

      if (this.postsStock(sell.status)) {
        await this.unpostLines(tx, sell.locationId, sell.sellLines);
      } else {
        for (const l of sell.sellLines) await deallocateSellLine(tx, l.id);
      }

      const touched = await this.applySalesOrderDraws(tx, giveBack);
      await tx.transaction.delete({ where: { id } }); // lines + payments + allocations cascade
      await this.recomputeSalesOrderStatus(tx, touched);
    });

    await this.audit.record({
      model: 'Sell',
      subjectId: id,
      name: sell.refNo,
      action: 'deleted',
      after: { refNo: sell.refNo, finalTotal: Number(sell.finalTotal) },
    });
    return { success: true, msg: 'Sale deleted' };
  }

  /** Draft ⇄ Final. Going final issues stock; going draft reverses it. */
  async updateStatus(user: AccessPayload, id: number, next: 'final' | 'draft') {
    const businessId = user.businessId as number;
    const sell = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'SELL' },
      include: {
        sellLines: {
          include: {
            product: { select: { enableStock: true, name: true } },
            variation: { select: { productVariationId: true } },
          },
        },
        returns: { select: { id: true } },
      },
    });
    if (!sell) throw new NotFoundException('Sell not found');
    const target = upper(next);
    if (sell.status === target) return this.findOne(businessId, id);
    if (sell.returns.length) {
      throw new BadRequestException('This sale has a return against it and its status cannot change');
    }

    const lifo = await this.accountingMethod(businessId);
    await this.prisma.$transaction(async (tx) => {
      if (target === 'FINAL') {
        await this.postLines(
          tx,
          businessId,
          sell.locationId,
          lifo,
          sell.sellLines.map((l) => ({
            id: l.id,
            productId: l.productId,
            productVariationId: l.variation.productVariationId,
            variationId: l.variationId,
            baseQuantity: Number(l.quantity),
            enableStock: l.product.enableStock,
            name: l.product.name,
          })),
        );
      } else {
        await this.unpostLines(tx, sell.locationId, sell.sellLines);
      }
      await tx.transaction.update({ where: { id }, data: { status: target, subStatus: null } });
    });

    await this.audit.record({
      model: 'Sell',
      subjectId: id,
      name: sell.refNo,
      action: 'updated',
      before: { status: sell.status.toLowerCase() },
      after: { status: next },
    });
    return this.findOne(businessId, id);
  }

  /**
   * Set each touched sales order's status from its OWN sell lines. The purchase draw-down helper
   * can't do this — it reads `purchase_lines`, and a sales order has none; its counter lives on
   * `transaction_sell_lines.so_quantity_invoiced`.
   */
  private async recomputeSalesOrderStatus(tx: Prisma.TransactionClient, ids: number[]) {
    if (!ids.length) return;
    const grouped = await tx.transactionSellLine.groupBy({
      by: ['transactionId'],
      where: { transactionId: { in: ids } },
      _sum: { quantity: true, soQuantityInvoiced: true },
    });
    await Promise.all(
      grouped.map((g) => {
        const ordered = Number(g._sum.quantity ?? 0);
        const invoiced = Number(g._sum.soQuantityInvoiced ?? 0);
        const status = invoiced <= 0.00005 ? 'ORDERED' : ordered - invoiced <= 0.00005 ? 'COMPLETED' : 'PARTIAL';
        return tx.transaction.update({ where: { id: g.transactionId }, data: { status } });
      }),
    );
  }

  // ── sales-order draw-down (mirror of the purchase side) ──
  private async applySalesOrderDraws(tx: Prisma.TransactionClient, entries: DrawDown[]): Promise<number[]> {
    // Sales-order counters live on transaction_sell_lines.so_quantity_invoiced, not purchase_lines,
    // so the generic purchase draw-down helper can't be reused. Same shape, different table.
    const byLine = new Map<number, number>();
    for (const e of entries) byLine.set(e.lineId, (byLine.get(e.lineId) ?? 0) + e.delta);
    const net = [...byLine.entries()].map(([lineId, delta]) => ({ lineId, delta: round4(delta) })).filter((e) => e.delta !== 0);
    if (!net.length) return [];

    const lines = await tx.transactionSellLine.findMany({
      where: { id: { in: net.map((e) => e.lineId) } },
      select: { id: true, quantity: true, soQuantityInvoiced: true, transactionId: true, product: { select: { name: true } } },
    });
    const byId = new Map(lines.map((l) => [l.id, l]));
    for (const e of net) {
      const line = byId.get(e.lineId);
      if (!line) throw new BadRequestException('One or more sales-order lines no longer exist');
      const nextVal = round4(Number(line.soQuantityInvoiced) + e.delta);
      if (nextVal < -0.00005) throw new BadRequestException('More would be returned to the sales order than was taken');
      if (nextVal - Number(line.quantity) > 0.00005) {
        const left = round4(Number(line.quantity) - Number(line.soQuantityInvoiced));
        throw new BadRequestException(`Only ${left} of "${line.product.name}" is left on that sales order`);
      }
    }
    await Promise.all(
      net.map((e) => tx.transactionSellLine.update({ where: { id: e.lineId }, data: { soQuantityInvoiced: { increment: e.delta } } })),
    );
    return [...new Set(lines.map((l) => l.transactionId))];
  }

  // ── payments ──────────────────────────────────────────
  private async writePayments(
    tx: Prisma.TransactionClient,
    businessId: number,
    transactionId: number,
    userId: number,
    contactId: number,
    payments: SaveSellDto['payment'] & object[],
  ) {
    for (const p of payments ?? []) {
      if (!(Number(p.amount) > 0)) continue;
      const refNo = await this.refs.generate(businessId, 'sell_payment', 'PP');
      await tx.transactionPayment.create({
        data: {
          businessId,
          transactionId,
          paymentFor: contactId,
          amount: round4(Number(p.amount)),
          method: p.method,
          accountId: p.account_id ?? null,
          paymentRefNo: refNo,
          paidOn: p.paid_on ? new Date(p.paid_on) : new Date(),
          cardTransactionNumber: p.card_transaction_number ?? null,
          cardHolderName: p.card_holder_name ?? null,
          cardType: p.card_type ?? null,
          chequeNumber: p.cheque_number ?? null,
          bankAccountNumber: p.bank_account_number ?? null,
          transactionNo: p.transaction_no ?? null,
          note: p.note ?? null,
          createdBy: userId,
        },
      });
    }
  }

  private async syncPaymentStatus(tx: Prisma.TransactionClient, transactionId: number, finalTotal: number) {
    const agg = await tx.transactionPayment.aggregate({ where: { transactionId }, _sum: { amount: true } });
    await tx.transaction.update({
      where: { id: transactionId },
      data: { paymentStatus: paymentStatusFor(finalTotal, Number(agg._sum.amount ?? 0)) },
    });
  }

  async addPayment(user: AccessPayload, id: number, dto: SavePaymentDto) {
    const businessId = user.businessId as number;
    const sell = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'SELL' },
      include: { payments: { select: { amount: true } } },
    });
    if (!sell) throw new NotFoundException('Sell not found');
    if (sell.status === 'DRAFT') throw new BadRequestException('A draft sale cannot take a payment');

    const paid = sell.payments.reduce((s, p) => s + Number(p.amount), 0);
    const due = round4(Number(sell.finalTotal) - paid);
    if (Number(dto.amount) - due > 0.00005) throw new BadRequestException(`Only ${due} is still due on this sale`);

    await this.prisma.$transaction(async (tx) => {
      await this.writePayments(tx, businessId, id, user.sub, sell.contactId as number, [dto] as never);
      await this.syncPaymentStatus(tx, id, Number(sell.finalTotal));
    });

    await this.audit.record({
      model: 'Sell',
      subjectId: id,
      name: sell.refNo,
      action: 'updated',
      after: { payment: Number(dto.amount), method: dto.method },
    });
    return this.findOne(businessId, id);
  }

  async removePayment(user: AccessPayload, paymentId: number) {
    const businessId = user.businessId as number;
    const payment = await this.prisma.transactionPayment.findFirst({
      where: { id: paymentId, businessId, transaction: { type: 'SELL' } },
      include: { transaction: { select: { id: true, refNo: true, finalTotal: true } } },
    });
    if (!payment?.transaction) throw new NotFoundException('Payment not found');
    const sell = payment.transaction;

    await this.prisma.$transaction(async (tx) => {
      await tx.transactionPayment.delete({ where: { id: paymentId } });
      await this.syncPaymentStatus(tx, sell.id, Number(sell.finalTotal));
    });

    await this.audit.record({ model: 'Sell', subjectId: sell.id, name: sell.refNo, action: 'updated', after: { paymentDeleted: Number(payment.amount) } });
    return { success: true, msg: 'Payment deleted' };
  }

  async listPayments(businessId: number, id: number) {
    const sell = await this.prisma.transaction.findFirst({ where: { id, businessId, type: 'SELL' }, select: { id: true } });
    if (!sell) throw new NotFoundException('Sell not found');
    const rows = await this.prisma.transactionPayment.findMany({ where: { transactionId: id }, orderBy: { paidOn: 'asc' } });
    return {
      data: rows.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        method: p.method,
        accountId: p.accountId,
        paymentRefNo: p.paymentRefNo,
        paidOn: p.paidOn,
        note: p.note ?? '',
      })),
    };
  }

  // ── reads ─────────────────────────────────────────────
  private isOverdue(r: { paymentStatus: string; payTermNumber: number | null; payTermType: string | null; transactionDate: Date }): boolean {
    if (r.paymentStatus === 'PAID' || !r.payTermNumber || !r.payTermType) return false;
    const due = new Date(r.transactionDate);
    if (r.payTermType === 'MONTHS') due.setMonth(due.getMonth() + r.payTermNumber);
    else due.setDate(due.getDate() + r.payTermNumber);
    return due < new Date();
  }

  async list(user: AccessPayload, query: import('./dto/sell.dto').SellsQueryDto) {
    const businessId = user.businessId as number;
    const s = query.search.trim();

    const and: Prisma.TransactionWhereInput[] = [{ businessId, type: 'SELL' }];
    if (query.locationId) and.push({ locationId: query.locationId });
    if (query.contactId) and.push({ contactId: query.contactId });
    if (query.status === 'final') and.push({ status: 'FINAL' });
    else if (query.status === 'quotation') and.push({ status: 'DRAFT', subStatus: 'QUOTATION' });
    else if (query.status === 'draft') and.push({ status: 'DRAFT' });
    if (query.dateFrom || query.dateTo) {
      and.push({
        transactionDate: {
          ...(query.dateFrom ? { gte: query.dateFrom } : {}),
          ...(query.dateTo ? { lte: endOfDay(query.dateTo) } : {}),
        },
      });
    }
    if (query.paymentStatus && query.paymentStatus !== 'overdue') {
      and.push({ paymentStatus: query.paymentStatus.toUpperCase() as 'PAID' | 'DUE' | 'PARTIAL' });
    }
    if (query.paymentStatus === 'overdue') {
      and.push({ paymentStatus: { in: ['DUE', 'PARTIAL'] }, payTermNumber: { not: null } });
    }
    if (s) {
      and.push({
        OR: [
          { refNo: { contains: s, mode: 'insensitive' } },
          { contact: { name: { contains: s, mode: 'insensitive' } } },
          { contact: { supplierBusinessName: { contains: s, mode: 'insensitive' } } },
        ],
      });
    }
    if (!(await this.ability.can(user, 'sell.view')) && !(await this.ability.can(user, 'direct_sell.view'))) {
      and.push({ createdBy: user.sub });
    }

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
          payments: { select: { amount: true } },
          _count: { select: { sellLines: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.aggregate({ where, _sum: { finalTotal: true } }),
    ]);

    const data = rows
      .map((r) => {
        const paid = r.payments.reduce((s2, p) => s2 + Number(p.amount), 0);
        return {
          id: r.id,
          refNo: r.refNo,
          transactionDate: r.transactionDate,
          customer: r.contact?.supplierBusinessName || r.contact?.name || '',
          location: r.location.name,
          status: r.status === 'DRAFT' ? (r.subStatus?.toLowerCase() ?? 'draft') : 'final',
          paymentStatus: r.paymentStatus.toLowerCase(),
          isOverdue: this.isOverdue(r),
          finalTotal: Number(r.finalTotal),
          paid: round4(paid),
          due: round4(Number(r.finalTotal) - paid),
          items: r._count.sellLines,
        };
      })
      .filter((r) => query.paymentStatus !== 'overdue' || r.isOverdue);

    return {
      data,
      total,
      totals: { finalTotal: round4(Number(totals._sum.finalTotal ?? 0)), due: round4(data.reduce((s2, r) => s2 + r.due, 0)) },
    };
  }

  async findOne(businessId: number, id: number) {
    const p = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'SELL' },
      include: {
        contact: { select: { id: true, name: true, supplierBusinessName: true, mobile: true } },
        location: { select: { id: true, name: true } },
        taxRate: { select: { id: true, name: true, amount: true } },
        payments: { orderBy: { paidOn: 'asc' } },
        sellLines: {
          orderBy: { id: 'asc' },
          include: {
            product: { select: { id: true, name: true, enableStock: true } },
            variation: { select: { id: true, name: true, subSku: true } },
            taxRate: { select: { id: true, name: true, amount: true } },
          },
        },
      },
    });
    if (!p) throw new NotFoundException('Sell not found');

    const paid = p.payments.reduce((s, x) => s + Number(x.amount), 0);
    return {
      id: p.id,
      refNo: p.refNo,
      transactionDate: p.transactionDate,
      status: p.status === 'DRAFT' ? (p.subStatus?.toLowerCase() ?? 'draft') : 'final',
      isDraft: p.status === 'DRAFT',
      paymentStatus: p.paymentStatus.toLowerCase(),
      contactId: p.contactId,
      customer: p.contact
        ? { id: p.contact.id, name: p.contact.supplierBusinessName || p.contact.name || '', mobile: p.contact.mobile }
        : null,
      locationId: p.locationId,
      location: p.location.name,
      lineSubtotal: Number(p.lineSubtotal),
      taxRateId: p.taxRateId,
      tax: p.taxRate ? { id: p.taxRate.id, name: p.taxRate.name, amount: Number(p.taxRate.amount) } : null,
      taxAmount: Number(p.taxAmount),
      discountType: p.discountType?.toLowerCase() ?? null,
      discountAmount: Number(p.discountAmount),
      shippingDetails: p.shippingDetails ?? '',
      shippingAddress: p.shippingAddress ?? '',
      shippingCharges: Number(p.shippingCharges),
      shippingStatus: p.shippingStatus?.toLowerCase() ?? null,
      deliveredTo: p.deliveredTo ?? '',
      additionalExpenses: (p.additionalExpenses as { name: string; amount: number }[] | null) ?? [],
      roundOffAmount: Number(p.roundOffAmount),
      finalTotal: Number(p.finalTotal),
      paid: round4(paid),
      due: round4(Number(p.finalTotal) - paid),
      payTermNumber: p.payTermNumber,
      payTermType: p.payTermType?.toLowerCase() ?? null,
      additionalNotes: p.additionalNotes ?? '',
      customField1: p.customField1 ?? '',
      customField2: p.customField2 ?? '',
      customField3: p.customField3 ?? '',
      customField4: p.customField4 ?? '',
      lines: p.sellLines.map((l) => ({
        id: l.id,
        productId: l.productId,
        variationId: l.variationId,
        product: l.product.name,
        variation: l.variation.name === 'DUMMY' ? '' : l.variation.name,
        sku: l.variation.subSku ?? '',
        quantity: Number(l.quantity),
        subUnitId: l.subUnitId,
        unitPrice: Number(l.unitPrice),
        unitPriceBeforeDiscount: Number(l.unitPriceBeforeDiscount),
        lineDiscountType: l.lineDiscountType?.toLowerCase() ?? null,
        lineDiscountAmount: Number(l.lineDiscountAmount),
        itemTax: Number(l.itemTax),
        unitPriceIncTax: Number(l.unitPriceIncTax),
        taxRateId: l.taxRateId,
        lineTotal: round4(Number(l.quantity) * Number(l.unitPriceIncTax)),
        quantityReturned: Number(l.quantityReturned),
        note: l.note ?? '',
      })),
      payments: p.payments.map((x) => ({
        id: x.id,
        amount: Number(x.amount),
        method: x.method,
        accountId: x.accountId,
        paymentRefNo: x.paymentRefNo,
        paidOn: x.paidOn,
        note: x.note ?? '',
      })),
    };
  }
}
