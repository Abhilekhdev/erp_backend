import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { AbilityService } from '../../common/services/ability.service';
import { ReferenceNumberService } from '../../common/services/reference-number.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../auth/token.service';
import { applyDrawDowns, recomputeDrawDownStatus, remainingOf, type DrawDown } from '../purchases/draw-down';
import { calcLine, calcTotals, round4 } from '../purchases/purchase.calc';
import type { PurchaseOrdersQueryDto, SavePurchaseOrderDto, UpdateShippingDto } from './dto/purchase-order.dto';

const STATUS = { ordered: 'ORDERED', partial: 'PARTIAL', completed: 'COMPLETED' } as const;
const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);
const endOfDay = (d: Date) => new Date(new Date(d).setHours(23, 59, 59, 999));
const upper = <T extends string>(v: T) => v.toUpperCase() as Uppercase<T>;

/**
 * Purchase orders — a priced commitment to a supplier that has not arrived yet.
 *
 * A purchase order NEVER touches stock. In GOURI that is an accident rather than a rule: its line
 * writer only moves stock when `status == 'received' && is_approved == 1`, and an order's status
 * is never `received`, so the branch is simply unreachable. Here it is explicit — this service
 * does not depend on StockService at all.
 *
 * The status (`ordered` / `partial` / `completed`) is a reading of how much of the order has been
 * received into purchases; see `purchases/draw-down.ts`.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refs: ReferenceNumberService,
    private readonly audit: AuditService,
    private readonly ability: AbilityService,
  ) {}

  // ── validation + computation ──────────────────────────

  private async assertRefs(businessId: number, dto: SavePurchaseOrderDto) {
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
      select: { id: true, productId: true },
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

    // Requisition lines must belong to this tenant AND to the requisitions the order claims.
    const reqLineIds = [
      ...new Set(dto.purchases.map((p) => p.purchase_requisition_line_id).filter(Boolean) as number[]),
    ];
    if (reqLineIds.length) {
      const n = await this.prisma.purchaseLine.count({
        where: {
          id: { in: reqLineIds },
          transaction: { businessId, type: 'PURCHASE_REQUISITION' },
        },
      });
      if (n !== reqLineIds.length) {
        throw new BadRequestException('One or more requisition lines are invalid');
      }
    }

    return new Map(variations.map((v) => [v.id, v]));
  }

  /** Recompute every figure from the lines. Nothing monetary is taken from the request. */
  private async build(businessId: number, dto: SavePurchaseOrderDto) {
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
      const calc = calcLine(
        {
          quantity: line.quantity,
          pp_without_discount: line.pp_without_discount,
          discount_percent: line.discount_percent,
        } as never,
        line.tax_rate_id ? (taxPercent.get(line.tax_rate_id) ?? 0) : 0,
      );

      return {
        input: line,
        productId: v.productId,
        variationId: line.variation_id,
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
          purchaseRequisitionLineId: line.purchase_requisition_line_id ?? null,
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

    const toBase = (n: number) => round4(n * rate);
    return {
      lines,
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

  private header(dto: SavePurchaseOrderDto, money: Awaited<ReturnType<typeof this.build>>['money']) {
    return {
      contactId: dto.contact_id,
      locationId: dto.location_id,
      transactionDate: new Date(dto.transaction_date),
      deliveryDate: dto.delivery_date ? new Date(dto.delivery_date) : null,
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
      lineSubtotal: money.lineSubtotal,
      finalTotal: money.finalTotal,
      exchangeRate: Number(dto.exchange_rate) || 1,
      additionalNotes: blank(dto.additional_notes),
      customField1: blank(dto.custom_field_1),
      customField2: blank(dto.custom_field_2),
      customField3: blank(dto.custom_field_3),
      customField4: blank(dto.custom_field_4),
      purchaseRequisitionIds: dto.purchase_requisition_ids?.length ? dto.purchase_requisition_ids : Prisma.JsonNull,
    };
  }

  // ── writes ────────────────────────────────────────────

  async create(user: AccessPayload, dto: SavePurchaseOrderDto) {
    const businessId = user.businessId as number;
    const { lines, money } = await this.build(businessId, dto);

    const refNo = blank(dto.ref_no) ?? (await this.refs.generate(businessId, 'purchase_order', 'PORD'));
    const clash = await this.prisma.transaction.findFirst({ where: { businessId, refNo }, select: { id: true } });
    if (clash) throw new ConflictException(`Reference number "${refNo}" is already used`);

    const id = await this.prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          businessId,
          type: 'PURCHASE_ORDER',
          // An order starts unfulfilled; the counter moves it from here.
          status: 'ORDERED',
          refNo,
          createdBy: user.sub,
          ...this.header(dto, money),
          purchaseLines: {
            create: lines.map((l) => ({ productId: l.productId, variationId: l.variationId, ...l.data })),
          },
        },
        select: { id: true, purchaseLines: { select: { id: true, purchaseRequisitionLineId: true, quantity: true } } },
      });

      // Taking from a requisition consumes it.
      const draws: DrawDown[] = created.purchaseLines
        .filter((l) => l.purchaseRequisitionLineId)
        .map((l) => ({ lineId: l.purchaseRequisitionLineId as number, delta: Number(l.quantity) }));
      const touched = await applyDrawDowns(tx, draws);
      await recomputeDrawDownStatus(tx, touched);

      return created.id;
    });

    await this.audit.record({
      model: 'PurchaseOrder',
      subjectId: id,
      name: refNo,
      action: 'created',
      after: { refNo, finalTotal: money.finalTotal, lines: lines.length },
    });

    return this.findOne(businessId, id);
  }

  async update(user: AccessPayload, id: number, dto: SavePurchaseOrderDto) {
    const businessId = user.businessId as number;
    const existing = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'PURCHASE_ORDER' },
      include: {
        purchaseLines: {
          select: { id: true, quantity: true, poQuantityPurchased: true, purchaseRequisitionLineId: true },
        },
      },
    });
    if (!existing) throw new NotFoundException('Purchase order not found');

    const { lines, money } = await this.build(businessId, dto);

    if (blank(dto.ref_no) && blank(dto.ref_no) !== existing.refNo) {
      const clash = await this.prisma.transaction.findFirst({
        where: { businessId, refNo: blank(dto.ref_no) as string, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw new ConflictException(`Reference number "${dto.ref_no}" is already used`);
    }

    const keptIds = lines.map((l) => l.input.purchase_line_id).filter(Boolean) as number[];
    const removed = existing.purchaseLines.filter((l) => !keptIds.includes(l.id));

    // A line that purchases have already been received against cannot be dropped or shrunk below
    // what was taken — GOURI lets you delete it and leaves the receipts pointing at nothing.
    for (const r of removed) {
      if (Number(r.poQuantityPurchased) > 0) {
        throw new ConflictException(
          'A line on this order has already been received into a purchase and cannot be removed',
        );
      }
    }
    const byId = new Map(existing.purchaseLines.map((l) => [l.id, l]));
    for (const l of lines) {
      const prev = l.input.purchase_line_id ? byId.get(l.input.purchase_line_id) : undefined;
      if (prev && l.data.quantity < Number(prev.poQuantityPurchased)) {
        throw new ConflictException(
          `A line cannot be reduced below the ${Number(prev.poQuantityPurchased)} already received against it`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // Give back what the old lines took from their requisitions, then take afresh.
      const giveBack: DrawDown[] = existing.purchaseLines
        .filter((l) => l.purchaseRequisitionLineId)
        .map((l) => ({ lineId: l.purchaseRequisitionLineId as number, delta: -Number(l.quantity) }));

      if (removed.length) {
        await tx.purchaseLine.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
      }

      for (const l of lines) {
        if (l.input.purchase_line_id && byId.has(l.input.purchase_line_id)) {
          await tx.purchaseLine.update({ where: { id: l.input.purchase_line_id }, data: l.data });
        } else {
          await tx.purchaseLine.create({
            data: { transactionId: id, productId: l.productId, variationId: l.variationId, ...l.data },
          });
        }
      }

      const after = await tx.purchaseLine.findMany({
        where: { transactionId: id },
        select: { id: true, quantity: true, purchaseRequisitionLineId: true },
      });
      const take: DrawDown[] = after
        .filter((l) => l.purchaseRequisitionLineId)
        .map((l) => ({ lineId: l.purchaseRequisitionLineId as number, delta: Number(l.quantity) }));

      const touched = await applyDrawDowns(tx, [...giveBack, ...take]);

      await tx.transaction.update({
        where: { id },
        data: { refNo: blank(dto.ref_no) ?? existing.refNo, ...this.header(dto, money) },
      });

      // This order's own status can move too: its lines changed, so ordered-vs-received changed.
      await recomputeDrawDownStatus(tx, [...new Set([...touched, id])]);
    });

    await this.audit.record({
      model: 'PurchaseOrder',
      subjectId: id,
      name: existing.refNo,
      action: 'updated',
      before: { finalTotal: Number(existing.finalTotal) },
      after: { finalTotal: money.finalTotal },
    });

    return this.findOne(businessId, id);
  }

  async updateShipping(user: AccessPayload, id: number, dto: UpdateShippingDto) {
    const businessId = user.businessId as number;
    const existing = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'PURCHASE_ORDER' },
      select: { id: true, refNo: true, shippingStatus: true },
    });
    if (!existing) throw new NotFoundException('Purchase order not found');

    await this.prisma.transaction.update({
      where: { id },
      data: {
        shippingStatus: upper(dto.shipping_status),
        deliveredTo: blank(dto.delivered_to),
        ...(dto.shipping_address !== undefined ? { shippingAddress: blank(dto.shipping_address) } : {}),
        ...(dto.delivery_date ? { deliveryDate: new Date(dto.delivery_date) } : {}),
      },
    });

    await this.audit.record({
      model: 'PurchaseOrder',
      subjectId: id,
      name: existing.refNo,
      action: 'updated',
      before: { shippingStatus: existing.shippingStatus?.toLowerCase() ?? null },
      after: { shippingStatus: dto.shipping_status },
    });
    return this.findOne(businessId, id);
  }

  async remove(user: AccessPayload, id: number) {
    const businessId = user.businessId as number;
    const existing = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'PURCHASE_ORDER' },
      include: {
        purchaseLines: {
          select: { quantity: true, poQuantityPurchased: true, purchaseRequisitionLineId: true },
        },
      },
    });
    if (!existing) throw new NotFoundException('Purchase order not found');

    // GOURI deletes a partly-received order, nulls the link on the receiving purchase lines and
    // leaves the goods and their stock with no order to explain them.
    const received = existing.purchaseLines.reduce((sum, l) => sum + Number(l.poQuantityPurchased), 0);
    if (received > 0) {
      throw new ConflictException(
        'Goods have already been received against this order — delete those purchases first',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const giveBack: DrawDown[] = existing.purchaseLines
        .filter((l) => l.purchaseRequisitionLineId)
        .map((l) => ({ lineId: l.purchaseRequisitionLineId as number, delta: -Number(l.quantity) }));
      const touched = await applyDrawDowns(tx, giveBack);
      await tx.transaction.delete({ where: { id } });
      await recomputeDrawDownStatus(tx, touched);
    });

    await this.audit.record({
      model: 'PurchaseOrder',
      subjectId: id,
      name: existing.refNo,
      action: 'deleted',
      after: { refNo: existing.refNo, finalTotal: Number(existing.finalTotal) },
    });
    return { success: true, msg: 'Purchase order deleted' };
  }

  // ── reads ─────────────────────────────────────────────

  async list(user: AccessPayload, query: PurchaseOrdersQueryDto) {
    const businessId = user.businessId as number;
    const s = query.search.trim();

    const and: Prisma.TransactionWhereInput[] = [{ businessId, type: 'PURCHASE_ORDER' }];
    if (query.locationId) and.push({ locationId: query.locationId });
    if (query.contactId) and.push({ contactId: query.contactId });
    if (query.status) and.push({ status: STATUS[query.status] });
    if (query.shippingStatus) and.push({ shippingStatus: upper(query.shippingStatus) });
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
          { contact: { name: { contains: s, mode: 'insensitive' } } },
          { contact: { supplierBusinessName: { contains: s, mode: 'insensitive' } } },
        ],
      });
    }
    if (!(await this.ability.can(user, 'purchase_order.view_all'))) and.push({ createdBy: user.sub });

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
          purchaseLines: { select: { quantity: true, poQuantityPurchased: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.aggregate({ where, _sum: { finalTotal: true } }),
    ]);

    const names = await this.userNames(rows.map((r) => r.createdBy));
    return {
      data: rows.map((r) => {
        const ordered = r.purchaseLines.reduce((sum, l) => sum + Number(l.quantity), 0);
        const received = r.purchaseLines.reduce((sum, l) => sum + Number(l.poQuantityPurchased), 0);
        return {
          id: r.id,
          refNo: r.refNo,
          transactionDate: r.transactionDate,
          deliveryDate: r.deliveryDate,
          supplier: r.contact?.supplierBusinessName || r.contact?.name || '',
          location: r.location.name,
          status: r.status.toLowerCase(),
          shippingStatus: r.shippingStatus?.toLowerCase() ?? null,
          finalTotal: Number(r.finalTotal),
          items: r.purchaseLines.length,
          quantityOrdered: round4(ordered),
          quantityRemaining: round4(ordered - received),
          addedBy: names.get(r.createdBy) ?? '',
        };
      }),
      total,
      totals: { finalTotal: round4(Number(totals._sum.finalTotal ?? 0)) },
    };
  }

  async findOne(businessId: number, id: number) {
    const p = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'PURCHASE_ORDER' },
      include: {
        contact: { select: { id: true, name: true, supplierBusinessName: true, mobile: true } },
        location: { select: { id: true, name: true } },
        taxRate: { select: { id: true, name: true, amount: true } },
        purchaseLines: {
          orderBy: { id: 'asc' },
          include: {
            product: { select: { id: true, name: true } },
            variation: { select: { id: true, name: true, subSku: true } },
          },
        },
      },
    });
    if (!p) throw new NotFoundException('Purchase order not found');

    const reqIds = (p.purchaseRequisitionIds as number[] | null) ?? [];
    const requisitions = reqIds.length
      ? await this.prisma.transaction.findMany({
          where: { id: { in: reqIds }, businessId, type: 'PURCHASE_REQUISITION' },
          select: { id: true, refNo: true },
        })
      : [];

    const names = await this.userNames([p.createdBy]);
    return {
      id: p.id,
      refNo: p.refNo,
      transactionDate: p.transactionDate,
      deliveryDate: p.deliveryDate,
      status: p.status.toLowerCase(),
      shippingStatus: p.shippingStatus?.toLowerCase() ?? null,
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
      shippingAddress: p.shippingAddress ?? '',
      shippingCharges: Number(p.shippingCharges),
      deliveredTo: p.deliveredTo ?? '',
      additionalExpenses: (p.additionalExpenses as { name: string; amount: number }[] | null) ?? [],
      finalTotal: Number(p.finalTotal),
      payTermNumber: p.payTermNumber,
      payTermType: p.payTermType?.toLowerCase() ?? null,
      exchangeRate: Number(p.exchangeRate),
      additionalNotes: p.additionalNotes ?? '',
      customField1: p.customField1 ?? '',
      customField2: p.customField2 ?? '',
      customField3: p.customField3 ?? '',
      customField4: p.customField4 ?? '',
      requisitions,
      addedBy: names.get(p.createdBy) ?? '',
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
        purchaseRequisitionLineId: l.purchaseRequisitionLineId,
        quantityReceived: Number(l.poQuantityPurchased),
        quantityRemaining: remainingOf(l),
      })),
    };
  }

  /**
   * Open orders for a supplier, with the lines a purchase can still draw from.
   * GOURI's equivalent ignores permitted locations entirely, so a user confined to one location
   * can pull in orders raised for a location they cannot even see.
   */
  async openForSupplier(user: AccessPayload, contactId: number, locationId?: number) {
    const businessId = user.businessId as number;
    const rows = await this.prisma.transaction.findMany({
      where: {
        businessId,
        type: 'PURCHASE_ORDER',
        contactId,
        status: { in: ['ORDERED', 'PARTIAL'] },
        ...(locationId ? { locationId } : {}),
      },
      orderBy: { transactionDate: 'desc' },
      include: {
        purchaseLines: {
          orderBy: { id: 'asc' },
          include: {
            product: { select: { id: true, name: true, enableStock: true } },
            variation: { select: { id: true, name: true, subSku: true } },
          },
        },
      },
    });

    return {
      data: rows.map((r) => ({
        id: r.id,
        refNo: r.refNo,
        transactionDate: r.transactionDate,
        status: r.status.toLowerCase(),
        shippingDetails: r.shippingDetails ?? '',
        shippingCharges: Number(r.shippingCharges),
        additionalExpenses: (r.additionalExpenses as { name: string; amount: number }[] | null) ?? [],
        lines: r.purchaseLines
          // A fully-received line has nothing left to pull in; GOURI hides these too.
          .filter((l) => remainingOf(l) > 0)
          .map((l) => ({
            id: l.id,
            productId: l.productId,
            variationId: l.variationId,
            product: l.product.name,
            variation: l.variation.name === 'DUMMY' ? '' : l.variation.name,
            sku: l.variation.subSku ?? '',
            quantityRemaining: remainingOf(l),
            ppWithoutDiscount: Number(l.ppWithoutDiscount),
            discountPercent: Number(l.discountPercent),
            taxRateId: l.taxRateId,
          })),
      })),
    };
  }

  /** Open requisitions at a location, with the lines an order can still draw from. */
  async openRequisitions(user: AccessPayload, locationId: number) {
    const businessId = user.businessId as number;
    const rows = await this.prisma.transaction.findMany({
      where: {
        businessId,
        type: 'PURCHASE_REQUISITION',
        locationId,
        status: { in: ['ORDERED', 'PARTIAL'] },
      },
      orderBy: { transactionDate: 'desc' },
      include: {
        purchaseLines: {
          orderBy: { id: 'asc' },
          include: {
            product: { select: { id: true, name: true } },
            variation: {
              select: { id: true, name: true, subSku: true, defaultPurchasePrice: true },
            },
          },
        },
      },
    });

    return {
      data: rows.map((r) => ({
        id: r.id,
        refNo: r.refNo,
        transactionDate: r.transactionDate,
        deliveryDate: r.deliveryDate,
        status: r.status.toLowerCase(),
        lines: r.purchaseLines
          .filter((l) => remainingOf(l) > 0)
          .map((l) => ({
            id: l.id,
            productId: l.productId,
            variationId: l.variationId,
            product: l.product.name,
            variation: l.variation.name === 'DUMMY' ? '' : l.variation.name,
            sku: l.variation.subSku ?? '',
            quantityRemaining: remainingOf(l),
            defaultPurchasePrice:
              l.variation.defaultPurchasePrice != null ? Number(l.variation.defaultPurchasePrice) : 0,
          })),
      })),
    };
  }

  private async userNames(ids: number[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, surname: true, firstName: true, lastName: true },
    });
    return new Map(
      users.map((u) => [u.id, [u.surname, u.firstName, u.lastName].filter(Boolean).join(' ').trim()]),
    );
  }
}
