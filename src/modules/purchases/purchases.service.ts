import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type TransactionStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { AbilityService } from '../../common/services/ability.service';
import { ReferenceNumberService } from '../../common/services/reference-number.service';
import { StockService, type StockMovement } from '../../common/services/stock.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../auth/token.service';
import type {
  PurchasesQueryDto,
  SavePaymentDto,
} from './dto/purchases-query.dto';
import type { PurchaseLineInput, SavePurchaseDto } from './dto/save-purchase.dto';
import { applyDrawDowns, recomputeDrawDownStatus } from './draw-down';
import { calcLine, calcTotals, paymentStatusFor, round4 } from './purchase.calc';

const STATUS: Record<string, TransactionStatus> = {
  received: 'RECEIVED',
  pending: 'PENDING',
  ordered: 'ORDERED',
};
const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);
const date = (v?: string | null): Date | null => (v ? new Date(v) : null);

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly refs: ReferenceNumberService,
    private readonly audit: AuditService,
    private readonly ability: AbilityService,
  ) {}

  /** Stock exists only for a RECEIVED, APPROVED purchase — GOURI's gate, kept. */
  private postsStock(status: TransactionStatus, isApproved: boolean): boolean {
    return status === 'RECEIVED' && isApproved;
  }

  // ── validation ────────────────────────────────────────

  private async assertRefs(businessId: number, dto: SavePurchaseDto) {
    const [supplier, location] = await Promise.all([
      this.prisma.contact.findFirst({
        where: { id: dto.contact_id, businessId, deletedAt: null, type: { in: ['supplier', 'both'] } },
        select: { id: true },
      }),
      this.prisma.businessLocation.findFirst({
        where: { id: dto.location_id, businessId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (!supplier) throw new BadRequestException('Selected supplier is invalid');
    if (!location) throw new BadRequestException('Selected business location is invalid');

    const variationIds = [...new Set(dto.purchases.map((p) => p.variation_id))];
    const variations = await this.prisma.variation.findMany({
      where: { id: { in: variationIds }, deletedAt: null, product: { businessId } },
      select: { id: true, productId: true, productVariationId: true },
    });
    if (variations.length !== variationIds.length) {
      throw new BadRequestException('One or more products are invalid');
    }

    const taxIds = [
      ...new Set([dto.tax_rate_id, ...dto.purchases.map((p) => p.tax_rate_id)].filter(Boolean) as number[]),
    ];
    if (taxIds.length) {
      const n = await this.prisma.taxRate.count({ where: { id: { in: taxIds }, businessId, deletedAt: null } });
      if (n !== taxIds.length) throw new BadRequestException('One or more tax rates are invalid');
    }

    const subUnitIds = [...new Set(dto.purchases.map((p) => p.sub_unit_id).filter(Boolean) as number[])];
    if (subUnitIds.length) {
      const n = await this.prisma.unit.count({ where: { id: { in: subUnitIds }, businessId, deletedAt: null } });
      if (n !== subUnitIds.length) throw new BadRequestException('One or more units are invalid');
    }

    return new Map(variations.map((v) => [v.id, v]));
  }

  /**
   * Recompute every figure from the lines. Nothing monetary is taken from the request except the
   * prices the user typed — see purchase.calc.ts for why.
   */
  private async build(businessId: number, dto: SavePurchaseDto) {
    const variations = await this.assertRefs(businessId, dto);

    const taxIds = [
      ...new Set([dto.tax_rate_id, ...dto.purchases.map((p) => p.tax_rate_id)].filter(Boolean) as number[]),
    ];
    const taxRates = taxIds.length
      ? await this.prisma.taxRate.findMany({ where: { id: { in: taxIds } }, select: { id: true, amount: true } })
      : [];
    const taxPercent = new Map(taxRates.map((t) => [t.id, Number(t.amount)]));

    const subUnitIds = [...new Set(dto.purchases.map((p) => p.sub_unit_id).filter(Boolean) as number[])];
    const subUnits = subUnitIds.length
      ? await this.prisma.unit.findMany({
          where: { id: { in: subUnitIds } },
          select: { id: true, baseUnitMultiplier: true },
        })
      : [];
    const multiplierOf = new Map(subUnits.map((u) => [u.id, Number(u.baseUnitMultiplier ?? 1) || 1]));

    const rate = Number(dto.exchange_rate) || 1;
    const lines = dto.purchases.map((line) => {
      const v = variations.get(line.variation_id)!;
      const multiplier = line.sub_unit_id ? (multiplierOf.get(line.sub_unit_id) ?? 1) : 1;
      const calc = calcLine(line, line.tax_rate_id ? (taxPercent.get(line.tax_rate_id) ?? 0) : 0);

      // Quantity scales UP to the base unit; unit prices scale DOWN to it. Both then convert to the
      // base currency. This is GOURI's `createOrUpdatePurchaseLines` arithmetic.
      return {
        input: line,
        productId: v.productId,
        productVariationId: v.productVariationId,
        variationId: line.variation_id,
        quantityBase: round4(Number(line.quantity) * multiplier),
        data: {
          quantity: round4(Number(line.quantity) * multiplier),
          subUnitId: line.sub_unit_id ?? null,
          secondaryUnitQuantity: round4(Number(line.secondary_unit_quantity) || 0),
          ppWithoutDiscount: round4(((Number(line.pp_without_discount) || 0) * rate) / multiplier),
          discountPercent: round4(Number(line.discount_percent) || 0),
          purchasePrice: round4((calc.purchasePrice * rate) / multiplier),
          itemTax: round4((calc.itemTax * rate) / multiplier),
          purchasePriceIncTax: round4((calc.purchasePriceIncTax * rate) / multiplier),
          taxRateId: line.tax_rate_id ?? null,
          lotNumber: blank(line.lot_number),
          mfgDate: date(line.mfg_date),
          expDate: date(line.exp_date),
          purchaseOrderLineId: line.purchase_order_line_id ?? null,
        },
        lineTotal: calc.lineTotal,
      };
    });

    const totals = calcTotals({
      lineSubtotal: lines.reduce((s, l) => s + l.lineTotal, 0),
      discountType: dto.discount_type,
      discountAmount: Number(dto.discount_amount) || 0,
      orderTaxPercent: dto.tax_rate_id ? (taxPercent.get(dto.tax_rate_id) ?? 0) : 0,
      shippingCharges: Number(dto.shipping_charges) || 0,
      additionalExpenses: dto.additional_expenses,
    });

    // Amounts are entered in the purchase currency and stored in the base currency. A percentage
    // discount is a ratio, so it is deliberately not converted — GOURI does the same.
    const toBase = (n: number) => round4(n * rate);
    return {
      lines,
      totals,
      money: {
        lineSubtotal: toBase(totals.lineSubtotal),
        taxAmount: toBase(totals.taxAmount),
        discountAmount:
          dto.discount_type === 'fixed' ? toBase(Number(dto.discount_amount) || 0) : Number(dto.discount_amount) || 0,
        shippingCharges: toBase(Number(dto.shipping_charges) || 0),
        finalTotal: toBase(totals.finalTotal),
        additionalExpenses: (dto.additional_expenses ?? []).map((e) => ({
          name: e.name,
          amount: toBase(Number(e.amount) || 0),
        })),
      },
    };
  }

  /** Only a user holding `purchase.approve` may leave a purchase unapproved. */
  private async resolveApproval(user: AccessPayload, requested?: boolean): Promise<boolean> {
    if (requested !== false) return true;
    const canApprove = await this.ability.can(user, 'purchase.approve');
    // Without the permission the flag is ignored rather than rejected: in GOURI the field simply
    // isn't rendered for those users, so they silently saved `is_approved = null` and their stock
    // never posted. Defaulting to approved is the safe reading of "no opinion".
    return !canApprove;
  }

  // ── create ────────────────────────────────────────────

  async create(user: AccessPayload, dto: SavePurchaseDto) {
    const businessId = user.businessId as number;
    const built = await this.build(businessId, dto);
    const status = STATUS[dto.status];
    const isApproved = await this.resolveApproval(user, dto.is_approved);

    const refNo = blank(dto.ref_no) ?? (await this.refs.generate(businessId, 'purchase', 'PO'));
    if (await this.prisma.transaction.findFirst({ where: { businessId, refNo }, select: { id: true } })) {
      throw new ConflictException(`Reference number "${refNo}" is already used`);
    }

    const id = await this.prisma.$transaction(
      async (tx) => {
        const purchase = await tx.transaction.create({
          data: {
            businessId,
            locationId: dto.location_id,
            type: 'PURCHASE',
            status,
            contactId: dto.contact_id,
            refNo,
            transactionDate: new Date(dto.transaction_date),
            lineSubtotal: built.money.lineSubtotal,
            taxRateId: dto.tax_rate_id ?? null,
            taxAmount: built.money.taxAmount,
            discountType: dto.discount_type ? (dto.discount_type.toUpperCase() as 'FIXED' | 'PERCENTAGE') : null,
            discountAmount: built.money.discountAmount,
            shippingDetails: blank(dto.shipping_details),
            shippingCharges: built.money.shippingCharges,
            additionalExpenses: built.money.additionalExpenses.length
              ? (built.money.additionalExpenses as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            finalTotal: built.money.finalTotal,
            paymentStatus: 'DUE',
            payTermNumber: dto.pay_term_number ?? null,
            payTermType: dto.pay_term_type ? (dto.pay_term_type.toUpperCase() as 'DAYS' | 'MONTHS') : null,
            isApproved,
            approvedBy: isApproved ? user.sub : null,
            approvedAt: isApproved ? new Date() : null,
            exchangeRate: Number(dto.exchange_rate) || 1,
            additionalNotes: blank(dto.additional_notes),
            document: blank(dto.document),
            customField1: blank(dto.custom_field_1),
            customField2: blank(dto.custom_field_2),
            customField3: blank(dto.custom_field_3),
            customField4: blank(dto.custom_field_4),
            purchaseOrderIds: dto.purchase_order_ids?.length ? dto.purchase_order_ids : Prisma.JsonNull,
            createdBy: user.sub,
          },
        });

        await tx.purchaseLine.createMany({
          data: built.lines.map((l) => ({
            transactionId: purchase.id,
            productId: l.productId,
            variationId: l.variationId,
            ...l.data,
          })),
        });

        // Receiving against a purchase order consumes it and may complete it.
        const touched = await applyDrawDowns(
          tx,
          built.lines
            .filter((l) => l.data.purchaseOrderLineId)
            .map((l) => ({ lineId: l.data.purchaseOrderLineId as number, delta: l.quantityBase })),
        );
        await recomputeDrawDownStatus(tx, touched);

        if (this.postsStock(status, isApproved)) {
          await this.stock.moveMany(tx, built.lines.map((l) => this.movement(dto.location_id, l, l.quantityBase)));
        }
        await this.applySellPrices(tx, built.lines);
        await this.writePayments(tx, businessId, purchase.id, user.sub, dto.contact_id, dto.payment ?? []);
        await this.syncPaymentStatus(tx, purchase.id, built.money.finalTotal);
        return purchase.id;
      },
      { timeout: 30000 },
    );

    this.audit.log({
      action: 'created',
      subjectType: 'Purchase',
      subjectId: id,
      businessId,
      description: `Purchase "${refNo}" created`,
      properties: { attributes: { refNo, finalTotal: built.money.finalTotal, status: dto.status } },
    });
    return this.findOne(businessId, id);
  }

  private movement(locationId: number, line: { productId: number; productVariationId: number; variationId: number }, delta: number): StockMovement {
    return {
      locationId,
      productId: line.productId,
      productVariationId: line.productVariationId,
      variationId: line.variationId,
      delta,
    };
  }

  /** GOURI lets the buyer set the selling price straight from the purchase screen. */
  private async applySellPrices(
    tx: Prisma.TransactionClient,
    lines: { variationId: number; input: PurchaseLineInput }[],
  ) {
    for (const l of lines) {
      if (l.input.default_sell_price == null) continue;
      await tx.variation.update({
        where: { id: l.variationId },
        data: { sellPriceIncTax: l.input.default_sell_price },
      });
    }
  }

  // ── update ────────────────────────────────────────────

  async update(user: AccessPayload, id: number, dto: SavePurchaseDto) {
    const businessId = user.businessId as number;
    const existing = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'PURCHASE' },
      include: { purchaseLines: true, returns: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundException('Purchase not found');

    // GOURI checks both of these only when RENDERING the edit form, never on the PUT — a direct
    // request bypasses them entirely. Enforced here, where it actually matters.
    if (existing.returns.length) {
      throw new BadRequestException('This purchase has a return against it and can no longer be edited');
    }
    await this.assertWithinEditWindow(businessId, existing.transactionDate);

    const built = await this.build(businessId, dto);
    const status = STATUS[dto.status];
    const isApproved = await this.resolveApproval(user, dto.is_approved);
    const wasPosting = this.postsStock(existing.status, existing.isApproved);
    const nowPosting = this.postsStock(status, isApproved);

    // The location is fixed after creation: its stock already moved there, and GOURI disables the
    // field on edit for the same reason.
    const locationId = existing.locationId;

    const refNo = blank(dto.ref_no) ?? existing.refNo;
    if (refNo !== existing.refNo) {
      const clash = await this.prisma.transaction.findFirst({
        where: { businessId, refNo, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw new ConflictException(`Reference number "${refNo}" is already used`);
    }

    await this.prisma.$transaction(
      async (tx) => {
        // Reverse whatever the old lines had posted, then post the new ones. Simpler and more
        // obviously correct than GOURI's per-line delta matrix, and it cannot drift.
        if (wasPosting) {
          for (const old of existing.purchaseLines) {
            await this.stock.move(tx, {
              locationId,
              productId: old.productId,
              productVariationId: (await tx.variation.findUniqueOrThrow({
                where: { id: old.variationId },
                select: { productVariationId: true },
              })).productVariationId,
              variationId: old.variationId,
              delta: -Number(old.quantity),
            });
          }
        }

        // Hand back everything the old lines took from their purchase orders, then take afresh —
        // the same reverse-then-reapply shape as the stock above.
        const giveBack = existing.purchaseLines
          .filter((l) => l.purchaseOrderLineId)
          .map((l) => ({ lineId: l.purchaseOrderLineId as number, delta: -Number(l.quantity) }));
        const take = built.lines
          .filter((l) => l.data.purchaseOrderLineId)
          .map((l) => ({ lineId: l.data.purchaseOrderLineId as number, delta: l.quantityBase }));

        await tx.purchaseLine.deleteMany({ where: { transactionId: id } });
        await tx.purchaseLine.createMany({
          data: built.lines.map((l) => ({
            transactionId: id,
            productId: l.productId,
            variationId: l.variationId,
            ...l.data,
          })),
        });

        const touched = await applyDrawDowns(tx, [...giveBack, ...take]);
        await recomputeDrawDownStatus(tx, touched);

        if (nowPosting) {
          await this.stock.moveMany(tx, built.lines.map((l) => this.movement(locationId, l, l.quantityBase)));
        }

        await tx.transaction.update({
          where: { id },
          data: {
            contactId: dto.contact_id,
            refNo,
            status,
            transactionDate: new Date(dto.transaction_date),
            lineSubtotal: built.money.lineSubtotal,
            taxRateId: dto.tax_rate_id ?? null,
            taxAmount: built.money.taxAmount,
            discountType: dto.discount_type ? (dto.discount_type.toUpperCase() as 'FIXED' | 'PERCENTAGE') : null,
            discountAmount: built.money.discountAmount,
            shippingDetails: blank(dto.shipping_details),
            shippingCharges: built.money.shippingCharges,
            additionalExpenses: built.money.additionalExpenses.length
              ? (built.money.additionalExpenses as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            finalTotal: built.money.finalTotal,
            payTermNumber: dto.pay_term_number ?? null,
            payTermType: dto.pay_term_type ? (dto.pay_term_type.toUpperCase() as 'DAYS' | 'MONTHS') : null,
            isApproved,
            approvedBy: isApproved ? (existing.approvedBy ?? user.sub) : null,
            approvedAt: isApproved ? (existing.approvedAt ?? new Date()) : null,
            exchangeRate: Number(dto.exchange_rate) || 1,
            additionalNotes: blank(dto.additional_notes),
            document: blank(dto.document) ?? existing.document,
            customField1: blank(dto.custom_field_1),
            customField2: blank(dto.custom_field_2),
            customField3: blank(dto.custom_field_3),
            customField4: blank(dto.custom_field_4),
            purchaseOrderIds: dto.purchase_order_ids?.length ? dto.purchase_order_ids : Prisma.JsonNull,
          },
        });

        await this.applySellPrices(tx, built.lines);
        await this.syncPaymentStatus(tx, id, built.money.finalTotal);
      },
      { timeout: 30000 },
    );

    this.audit.log({
      action: 'updated',
      subjectType: 'Purchase',
      subjectId: id,
      businessId,
      description: `Purchase "${refNo}" updated`,
      properties: {
        changed: {
          finalTotal: { from: Number(existing.finalTotal), to: built.money.finalTotal },
          status: { from: existing.status, to: status },
        },
      },
    });
    return this.findOne(businessId, id);
  }

  /** GOURI's `transaction_edit_days` window, enforced on the write and not only on the form. */
  private async assertWithinEditWindow(businessId: number, transactionDate: Date) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { transactionEditDays: true },
    });
    const days = business?.transactionEditDays;
    if (days == null) return;
    const deadline = new Date(transactionDate);
    deadline.setDate(deadline.getDate() + days);
    if (deadline < new Date()) {
      throw new BadRequestException(`Purchases can only be edited within ${days} days of the purchase date`);
    }
  }

  // ── status / approval ────────────────────────────────

  async updateStatus(user: AccessPayload, id: number, status: 'received' | 'pending' | 'ordered') {
    const businessId = user.businessId as number;
    const purchase = await this.loadForStockChange(businessId, id);
    const next = STATUS[status];
    await this.applyStockGateChange(purchase, next, purchase.isApproved);
    await this.prisma.transaction.update({ where: { id }, data: { status: next } });

    this.audit.log({
      action: 'updated',
      subjectType: 'Purchase',
      subjectId: id,
      businessId,
      description: `Purchase "${purchase.refNo}" status changed`,
      properties: { changed: { status: { from: purchase.status, to: next } } },
    });
    return this.findOne(businessId, id);
  }

  /**
   * Approving a purchase posts its stock.
   *
   * In GOURI it does not: `updateApproveStatus` writes only the three approval columns while
   * `updateProductStock` refuses to move stock unless `is_approved == '1'`. A purchase saved as
   * received-but-unapproved therefore never adds stock, and approving it later never fixes that —
   * the only way in is to re-save the whole purchase.
   */
  async updateApproval(user: AccessPayload, id: number, isApproved: boolean) {
    const businessId = user.businessId as number;
    const purchase = await this.loadForStockChange(businessId, id);
    await this.applyStockGateChange(purchase, purchase.status, isApproved);
    await this.prisma.transaction.update({
      where: { id },
      data: {
        isApproved,
        approvedBy: isApproved ? user.sub : null,
        approvedAt: isApproved ? new Date() : null,
      },
    });

    this.audit.log({
      action: 'updated',
      subjectType: 'Purchase',
      subjectId: id,
      businessId,
      description: `Purchase "${purchase.refNo}" ${isApproved ? 'approved' : 'un-approved'}`,
      properties: { changed: { isApproved: { from: purchase.isApproved, to: isApproved } } },
    });
    return this.findOne(businessId, id);
  }

  private async loadForStockChange(businessId: number, id: number) {
    const purchase = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'PURCHASE' },
      include: { purchaseLines: { include: { variation: { select: { productVariationId: true } } } } },
    });
    if (!purchase) throw new NotFoundException('Purchase not found');
    return purchase;
  }

  /** Post or reverse the whole purchase when the received/approved gate flips. */
  private async applyStockGateChange(
    purchase: Awaited<ReturnType<PurchasesService['loadForStockChange']>>,
    nextStatus: TransactionStatus,
    nextApproved: boolean,
  ) {
    const was = this.postsStock(purchase.status, purchase.isApproved);
    const now = this.postsStock(nextStatus, nextApproved);
    if (was === now) return;

    const sign = now ? 1 : -1;
    await this.prisma.$transaction(async (tx) => {
      for (const line of purchase.purchaseLines) {
        await this.stock.move(tx, {
          locationId: purchase.locationId,
          productId: line.productId,
          productVariationId: line.variation.productVariationId,
          variationId: line.variationId,
          delta: sign * Number(line.quantity),
        });
      }
    });
  }

  // ── delete ────────────────────────────────────────────

  async remove(user: AccessPayload, id: number) {
    const businessId = user.businessId as number;
    const purchase = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'PURCHASE' },
      include: {
        purchaseLines: { include: { variation: { select: { productVariationId: true } } } },
        returns: { select: { id: true } },
      },
    });
    if (!purchase) throw new NotFoundException('Purchase not found');
    if (purchase.returns.length) {
      throw new BadRequestException('This purchase has a return against it and cannot be deleted');
    }

    // Any lot already consumed by a sale/adjustment cannot be unwound. GOURI only guards this when
    // lot numbers are switched on; the risk exists either way.
    const consumed = purchase.purchaseLines.find(
      (l) =>
        Number(l.quantitySold) > 0 ||
        Number(l.quantityAdjusted) > 0 ||
        Number(l.quantityReturned) > 0 ||
        Number(l.mfgQuantityUsed) > 0,
    );
    if (consumed) {
      throw new BadRequestException('Some of this stock has already been sold or adjusted — this purchase cannot be deleted');
    }

    await this.prisma.$transaction(async (tx) => {
      // Only reverse what was actually posted. GOURI reverses whenever the status is received,
      // without checking approval, so deleting an unapproved purchase subtracts stock it never added.
      if (this.postsStock(purchase.status, purchase.isApproved)) {
        for (const line of purchase.purchaseLines) {
          await this.stock.move(tx, {
            locationId: purchase.locationId,
            productId: line.productId,
            productVariationId: line.variation.productVariationId,
            variationId: line.variationId,
            delta: -Number(line.quantity),
          });
        }
      }
      // Give the purchase orders their quantities back, so a deleted receipt reopens the order
      // instead of leaving it stuck at partial forever (GOURI just nulls the link and walks away).
      const giveBack = purchase.purchaseLines
        .filter((l) => l.purchaseOrderLineId)
        .map((l) => ({ lineId: l.purchaseOrderLineId as number, delta: -Number(l.quantity) }));
      const touched = await applyDrawDowns(tx, giveBack);

      await tx.transaction.delete({ where: { id } }); // lines + payments cascade
      await recomputeDrawDownStatus(tx, touched);
    });

    this.audit.log({
      action: 'deleted',
      subjectType: 'Purchase',
      subjectId: id,
      businessId,
      description: `Purchase "${purchase.refNo}" deleted`,
      properties: { attributes: { refNo: purchase.refNo, finalTotal: Number(purchase.finalTotal) } },
    });
    return { success: true, msg: 'Purchase deleted successfully' };
  }

  // ── payments ─────────────────────────────────────────

  private async writePayments(
    tx: Prisma.TransactionClient,
    businessId: number,
    transactionId: number,
    userId: number,
    contactId: number,
    payments: SavePaymentDto[] | { amount: number; method: string; [k: string]: unknown }[],
  ) {
    for (const p of payments) {
      const amount = Number(p.amount) || 0;
      if (amount <= 0) continue; // GOURI skips zero-amount rows too — a 0 payment is not a payment
      const refNo = await this.refs.generate(businessId, 'purchase_payment', 'PP');
      await tx.transactionPayment.create({
        data: {
          businessId,
          transactionId,
          amount,
          method: String(p.method),
          accountId: (p.account_id as number) ?? null,
          paymentRefNo: refNo,
          paidOn: p.paid_on ? new Date(String(p.paid_on)) : new Date(),
          paymentFor: contactId,
          cardTransactionNumber: blank(p.card_transaction_number as string),
          cardHolderName: blank(p.card_holder_name as string),
          cardType: blank(p.card_type as string),
          chequeNumber: blank(p.cheque_number as string),
          bankAccountNumber: blank(p.bank_account_number as string),
          transactionNo: blank(p.transaction_no as string),
          note: blank(p.note as string),
          createdBy: userId,
        },
      });
    }
  }

  private async syncPaymentStatus(tx: Prisma.TransactionClient, transactionId: number, finalTotal?: number) {
    const [paid, txn] = await Promise.all([
      tx.transactionPayment.aggregate({ where: { transactionId }, _sum: { amount: true } }),
      finalTotal == null
        ? tx.transaction.findUniqueOrThrow({ where: { id: transactionId }, select: { finalTotal: true } })
        : Promise.resolve(null),
    ]);
    const total = finalTotal ?? Number(txn!.finalTotal);
    const totalPaid = Number(paid._sum.amount ?? 0);
    await tx.transaction.update({
      where: { id: transactionId },
      data: { paymentStatus: paymentStatusFor(total, totalPaid) },
    });
  }

  async addPayment(user: AccessPayload, id: number, dto: SavePaymentDto) {
    const businessId = user.businessId as number;
    const purchase = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'PURCHASE' },
      select: { id: true, refNo: true, contactId: true, finalTotal: true },
    });
    if (!purchase) throw new NotFoundException('Purchase not found');

    await this.prisma.$transaction(async (tx) => {
      await this.writePayments(tx, businessId, id, user.sub, purchase.contactId as number, [dto]);
      await this.syncPaymentStatus(tx, id, Number(purchase.finalTotal));
    });

    this.audit.log({
      action: 'created',
      subjectType: 'PurchasePayment',
      subjectId: id,
      businessId,
      description: `Payment of ${dto.amount} recorded against purchase "${purchase.refNo}"`,
      properties: { attributes: { amount: dto.amount, method: dto.method } },
    });
    return this.findOne(businessId, id);
  }

  /**
   * The current filter set as a spreadsheet. GOURI does this in the browser (DataTables' Copy /
   * CSV / Excel / PDF buttons), so its export only ever contains the page you are looking at —
   * this one runs the same query without the page limit.
   */
  async exportExcel(user: AccessPayload, query: PurchasesQueryDto): Promise<Buffer> {
    const all = await this.list(user, { ...query, page: 1, pageSize: 10_000 });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Purchases');
    ws.columns = [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Reference No', key: 'refNo', width: 18 },
      { header: 'Location', key: 'location', width: 22 },
      { header: 'Supplier', key: 'supplier', width: 28 },
      { header: 'Purchase Status', key: 'status', width: 16 },
      { header: 'Payment Status', key: 'paymentStatus', width: 16 },
      { header: 'Approved', key: 'approved', width: 12 },
      { header: 'Items', key: 'items', width: 8 },
      { header: 'Grand Total', key: 'finalTotal', width: 16 },
      { header: 'Paid', key: 'paid', width: 14 },
      { header: 'Payment Due', key: 'due', width: 14 },
    ];
    ws.getRow(1).font = { bold: true };

    for (const p of all.data) {
      ws.addRow({
        date: p.transactionDate.toISOString().slice(0, 10),
        refNo: p.refNo,
        location: p.location,
        supplier: p.supplier,
        status: p.status,
        // The list computes "overdue"; keep that distinction in the export rather than losing it.
        paymentStatus: p.isOverdue && p.paymentStatus !== 'paid' ? `${p.paymentStatus} (overdue)` : p.paymentStatus,
        approved: p.isApproved ? 'Yes' : 'Pending',
        items: p.items,
        finalTotal: p.finalTotal,
        paid: p.paid,
        due: p.due,
      });
    }

    const totals = ws.addRow({
      supplier: 'Total',
      finalTotal: all.totals.finalTotal,
      due: all.totals.due,
    });
    totals.font = { bold: true };

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── screen data ───────────────────────────────────────

  /**
   * Everything the purchase form needs in one round-trip: dropdown sources plus the business
   * toggles that decide which fields exist at all (lot number, expiry, inline tax, sub-units…).
   * GOURI reads these from the session on every Blade render; we send them once per page load.
   */
  async meta(businessId: number) {
    const [business, locations, suppliers, taxRates] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: {
          enablePurchaseStatus: true,
          enableLotNumber: true,
          enableProductExpiry: true,
          expiryType: true,
          enableInlineTax: true,
          enableSubUnits: true,
          enableEditingProductFromPurchase: true,
          purchaseInDiffCurrency: true,
          pExchangeRate: true,
          currencyPrecision: true,
          quantityPrecision: true,
          defaultProfitPercent: true,
          currency: { select: { code: true, symbol: true } },
          purchaseCurrency: { select: { code: true, symbol: true } },
        },
      }),
      this.prisma.businessLocation.findMany({
        where: { businessId, deletedAt: null, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.contact.findMany({
        where: { businessId, deletedAt: null, type: { in: ['supplier', 'both'] }, contactStatus: 'active' },
        select: {
          id: true, name: true, supplierBusinessName: true, balance: true,
          payTermNumber: true, payTermType: true,
          addressLine1: true, addressLine2: true, city: true, state: true, country: true, zipCode: true,
          mobile: true, taxNumber: true,
        },
        orderBy: { supplierBusinessName: 'asc' },
      }),
      this.prisma.taxRate.findMany({
        where: { businessId, deletedAt: null, forTaxGroup: false },
        select: { id: true, name: true, amount: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      locations,
      suppliers: suppliers.map((c) => ({
        id: c.id,
        name: c.supplierBusinessName || c.name || '',
        contactName: c.name ?? '',
        balance: Number(c.balance),
        payTermNumber: c.payTermNumber,
        payTermType: c.payTermType?.toLowerCase() ?? null,
        mobile: c.mobile ?? '',
        taxNumber: c.taxNumber ?? '',
        address: [c.addressLine1, c.addressLine2, c.city, c.state, c.country, c.zipCode]
          .map((p) => p?.trim())
          .filter(Boolean)
          .join(', '),
      })),
      taxRates: taxRates.map((t) => ({ id: t.id, name: t.name, amount: Number(t.amount) })),
      // GOURI's `payment_types()`; the accounts module adds its own on top later.
      paymentMethods: [
        { value: 'cash', label: 'Cash' },
        { value: 'card', label: 'Card' },
        { value: 'cheque', label: 'Cheque' },
        { value: 'bank_transfer', label: 'Bank Transfer' },
        { value: 'other', label: 'Other' },
      ],
      settings: {
        enablePurchaseStatus: business.enablePurchaseStatus ?? true,
        enableLotNumber: business.enableLotNumber,
        enableProductExpiry: business.enableProductExpiry,
        // Only 'add_manufacturing' shows the Mfg Date input; otherwise expiry alone.
        showMfgDate: business.expiryType === 'ADD_MANUFACTURING',
        enableInlineTax: business.enableInlineTax,
        enableSubUnits: business.enableSubUnits,
        enableEditingProductFromPurchase: business.enableEditingProductFromPurchase,
        purchaseInDiffCurrency: business.purchaseInDiffCurrency,
        defaultExchangeRate: Number(business.pExchangeRate),
        currencyPrecision: business.currencyPrecision,
        quantityPrecision: business.quantityPrecision,
        defaultProfitPercent: Number(business.defaultProfitPercent),
        currency: business.currency,
        purchaseCurrency: business.purchaseCurrency ?? business.currency,
      },
    };
  }

  /**
   * Product picker for the line table. Returns one row per VARIATION (that is what a purchase line
   * points at), with the stock at the chosen location and the price the supplier last charged —
   * both of which GOURI renders inside the row.
   */
  async searchProducts(businessId: number, search: string, locationId?: number, contactId?: number) {
    const s = search.trim();
    if (s.length < 1) return { data: [] };

    const variations = await this.prisma.variation.findMany({
      where: {
        deletedAt: null,
        product: {
          businessId,
          isInactive: false,
          // A combo is assembled from its components, never purchased as a unit.
          type: { not: 'combo' },
          ...(locationId ? { OR: [{ locations: { some: { locationId } } }, { locations: { none: {} } }] } : {}),
        },
        OR: [
          { subSku: { contains: s, mode: 'insensitive' } },
          { product: { name: { contains: s, mode: 'insensitive' } } },
          { product: { sku: { contains: s, mode: 'insensitive' } } },
        ],
      },
      include: {
        productVariation: { select: { name: true } },
        product: {
          select: {
            id: true, name: true, type: true, enableStock: true, taxRateId: true,
            unitId: true, secondaryUnitId: true,
          },
        },
        // Always selected; the `where` narrows to the chosen location, or to none when unset.
        stockLevels: { where: { locationId: locationId ?? -1 }, select: { qtyAvailable: true } },
      },
      orderBy: { id: 'asc' },
      take: 30,
    });

    // What this supplier last charged for each of these variations — GOURI's "Previous unit price".
    const lastLines = contactId && variations.length
      ? await this.prisma.purchaseLine.findMany({
          where: {
            variationId: { in: variations.map((v) => v.id) },
            transaction: { businessId, type: 'PURCHASE', contactId },
          },
          select: { variationId: true, ppWithoutDiscount: true, discountPercent: true },
          orderBy: { id: 'desc' },
        })
      : [];
    const lastBy = new Map<number, { price: number; discountPercent: number }>();
    for (const l of lastLines) {
      if (!lastBy.has(l.variationId)) {
        lastBy.set(l.variationId, {
          price: Number(l.ppWithoutDiscount),
          discountPercent: Number(l.discountPercent),
        });
      }
    }

    // Sub-units share a base unit; the line lets the user buy in "Box" and store in "Piece".
    // Product has no `unit` relation (GOURI keeps unit_id as a plain column), so units are a
    // second lookup: the base units themselves plus everything hanging off them.
    const baseUnitIds = [...new Set(variations.map((v) => v.product.unitId).filter(Boolean) as number[])];
    const units = baseUnitIds.length
      ? await this.prisma.unit.findMany({
          where: {
            businessId,
            deletedAt: null,
            OR: [{ id: { in: baseUnitIds } }, { baseUnitId: { in: baseUnitIds } }],
          },
          select: {
            id: true, actualName: true, shortName: true, allowDecimal: true,
            baseUnitId: true, baseUnitMultiplier: true,
          },
        })
      : [];
    const unitById = new Map(units.map((u) => [u.id, u]));
    const subUnits = units.filter((u) => u.baseUnitId != null);

    return {
      data: variations.map((v) => {
        const p = v.product;
        const unit = p.unitId ? unitById.get(p.unitId) : undefined;
        const stock = locationId ? v.stockLevels : null;
        return {
          variationId: v.id,
          productId: p.id,
          name: p.name,
          // Only a variable product has a meaningful variation label.
          variation: p.type === 'variable' ? `${v.productVariation.name} - ${v.name}` : '',
          sku: v.subSku ?? '',
          enableStock: p.enableStock,
          currentStock: stock ? round4(stock.reduce((sum, sl) => sum + Number(sl.qtyAvailable), 0)) : null,
          taxRateId: p.taxRateId,
          unitId: p.unitId,
          unitName: unit?.shortName ?? '',
          allowDecimal: unit?.allowDecimal ?? true,
          secondaryUnitId: p.secondaryUnitId,
          subUnits: subUnits
            .filter((u) => u.baseUnitId === p.unitId)
            .map((u) => ({
              id: u.id,
              name: u.actualName,
              shortName: u.shortName,
              multiplier: Number(u.baseUnitMultiplier ?? 1),
            })),
          defaultPurchasePrice: v.defaultPurchasePrice != null ? Number(v.defaultPurchasePrice) : 0,
          dppIncTax: v.dppIncTax != null ? Number(v.dppIncTax) : 0,
          sellPriceIncTax: v.sellPriceIncTax != null ? Number(v.sellPriceIncTax) : 0,
          lastPurchase: lastBy.get(v.id) ?? null,
        };
      }),
    };
  }

  async listPayments(businessId: number, id: number) {
    const purchase = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'PURCHASE' },
      select: { id: true },
    });
    if (!purchase) throw new NotFoundException('Purchase not found');
    const rows = await this.prisma.transactionPayment.findMany({
      where: { transactionId: id },
      orderBy: { paidOn: 'asc' },
    });
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

  async removePayment(user: AccessPayload, paymentId: number) {
    const businessId = user.businessId as number;
    const payment = await this.prisma.transactionPayment.findFirst({
      where: { id: paymentId, businessId },
      select: { id: true, transactionId: true, amount: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.transactionPayment.delete({ where: { id: paymentId } });
      if (payment.transactionId) await this.syncPaymentStatus(tx, payment.transactionId);
    });

    this.audit.log({
      action: 'deleted',
      subjectType: 'PurchasePayment',
      subjectId: paymentId,
      businessId,
      description: `Payment of ${Number(payment.amount)} deleted`,
    });
    return { success: true, msg: 'Payment deleted successfully' };
  }

  // ── read ──────────────────────────────────────────────

  async list(user: AccessPayload, query: PurchasesQueryDto) {
    const businessId = user.businessId as number;
    const s = query.search.trim();

    const and: Prisma.TransactionWhereInput[] = [{ businessId, type: 'PURCHASE' }];
    if (query.locationId) and.push({ locationId: query.locationId });
    if (query.contactId) and.push({ contactId: query.contactId });
    if (query.status) and.push({ status: STATUS[query.status] });
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
      // Overdue is derived, never stored: unpaid AND past its credit term.
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
    // Without `purchase.view`, `view_own_purchase` limits the list to the user's own documents.
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
          payments: { select: { amount: true } },
          _count: { select: { purchaseLines: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.aggregate({ where, _sum: { finalTotal: true } }),
    ]);

    const data = rows
      .map((r) => {
        const paid = r.payments.reduce((sum, p) => sum + Number(p.amount), 0);
        return {
          id: r.id,
          refNo: r.refNo,
          transactionDate: r.transactionDate,
          supplier: r.contact?.supplierBusinessName || r.contact?.name || '',
          location: r.location.name,
          status: r.status.toLowerCase(),
          paymentStatus: r.paymentStatus.toLowerCase(),
          isApproved: r.isApproved,
          isOverdue: this.isOverdue(r),
          finalTotal: Number(r.finalTotal),
          paid: round4(paid),
          due: round4(Number(r.finalTotal) - paid),
          items: r._count.purchaseLines,
        };
      })
      .filter((r) => query.paymentStatus !== 'overdue' || r.isOverdue);

    const grandTotal = Number(totals._sum.finalTotal ?? 0);
    return {
      data,
      total,
      totals: { finalTotal: round4(grandTotal), due: round4(data.reduce((s, r) => s + r.due, 0)) },
    };
  }

  /** Unpaid past its credit term — GOURI computes this at read time and never stores it. */
  private isOverdue(r: { paymentStatus: string; payTermNumber: number | null; payTermType: string | null; transactionDate: Date }): boolean {
    if (r.paymentStatus === 'PAID' || !r.payTermNumber) return false;
    const due = new Date(r.transactionDate);
    if (r.payTermType === 'MONTHS') due.setMonth(due.getMonth() + r.payTermNumber);
    else due.setDate(due.getDate() + r.payTermNumber);
    return due < new Date();
  }

  async findOne(businessId: number, id: number) {
    const p = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'PURCHASE' },
      include: {
        contact: { select: { id: true, name: true, supplierBusinessName: true, mobile: true } },
        location: { select: { id: true, name: true } },
        taxRate: { select: { id: true, name: true, amount: true } },
        payments: { orderBy: { paidOn: 'asc' } },
        purchaseLines: {
          orderBy: { id: 'asc' },
          include: {
            product: { select: { id: true, name: true, enableStock: true } },
            variation: { select: { id: true, name: true, subSku: true } },
            taxRate: { select: { id: true, name: true, amount: true } },
          },
        },
      },
    });
    if (!p) throw new NotFoundException('Purchase not found');

    const paid = p.payments.reduce((sum, x) => sum + Number(x.amount), 0);
    return {
      id: p.id,
      refNo: p.refNo,
      transactionDate: p.transactionDate,
      status: p.status.toLowerCase(),
      paymentStatus: p.paymentStatus.toLowerCase(),
      isApproved: p.isApproved,
      approvedAt: p.approvedAt,
      contactId: p.contactId,
      supplier: p.contact
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
      shippingCharges: Number(p.shippingCharges),
      additionalExpenses: (p.additionalExpenses as { name: string; amount: number }[] | null) ?? [],
      finalTotal: Number(p.finalTotal),
      paid: round4(paid),
      due: round4(Number(p.finalTotal) - paid),
      payTermNumber: p.payTermNumber,
      payTermType: p.payTermType?.toLowerCase() ?? null,
      exchangeRate: Number(p.exchangeRate),
      additionalNotes: p.additionalNotes ?? '',
      document: p.document ?? '',
      customField1: p.customField1 ?? '',
      customField2: p.customField2 ?? '',
      customField3: p.customField3 ?? '',
      customField4: p.customField4 ?? '',
      lines: p.purchaseLines.map((l) => ({
        id: l.id,
        productId: l.productId,
        variationId: l.variationId,
        product: l.product.name,
        variation: l.variation.name === 'DUMMY' ? '' : l.variation.name,
        sku: l.variation.subSku ?? '',
        quantity: Number(l.quantity),
        subUnitId: l.subUnitId,
        ppWithoutDiscount: Number(l.ppWithoutDiscount),
        discountPercent: Number(l.discountPercent),
        purchasePrice: Number(l.purchasePrice),
        itemTax: Number(l.itemTax),
        purchasePriceIncTax: Number(l.purchasePriceIncTax),
        taxRateId: l.taxRateId,
        lineTotal: round4(Number(l.quantity) * Number(l.purchasePriceIncTax)),
        lotNumber: l.lotNumber ?? '',
        mfgDate: l.mfgDate,
        expDate: l.expDate,
        /** How much of this lot is still on hand — the FIFO figure. */
        quantityRemaining: round4(
          Number(l.quantity) -
            (Number(l.quantitySold) + Number(l.quantityAdjusted) + Number(l.quantityReturned) + Number(l.mfgQuantityUsed)),
        ),
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

/** A date-only `dateTo` must cover that whole day, or "today" returns nothing. */
function endOfDay(d: Date): Date {
  const x = new Date(d);
  if (x.getHours() === 0 && x.getMinutes() === 0 && x.getSeconds() === 0) x.setHours(23, 59, 59, 999);
  return x;
}
