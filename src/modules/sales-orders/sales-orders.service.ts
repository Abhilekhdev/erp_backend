import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { AbilityService } from '../../common/services/ability.service';
import { ReferenceNumberService } from '../../common/services/reference-number.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../auth/token.service';
import { calcSellLine, calcSellTotals, round4 } from '../sells/sell.calc';
import type { SaveSalesOrderDto, SalesOrdersQueryDto, UpdateSoShippingDto } from './dto/sales-order.dto';

const STATUS = { ordered: 'ORDERED', partial: 'PARTIAL', completed: 'COMPLETED' } as const;
const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);
const upper = <T extends string>(v: T) => v.toUpperCase() as Uppercase<T>;
const endOfDay = (d: Date) => new Date(new Date(d).setHours(23, 59, 59, 999));
const EPSILON = 0.00005;

/**
 * Sales orders — a customer's priced commitment, the sell-side mirror of a purchase order. It never
 * moves stock; a sell invoices it and draws down `so_quantity_invoiced` on its lines, which is what
 * its ordered/partial/completed status reads from. Same fixes as the purchase order: server-computed
 * totals, atomic counter, a completed/received line can't be dropped or shrunk below what was drawn.
 */
@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refs: ReferenceNumberService,
    private readonly audit: AuditService,
    private readonly ability: AbilityService,
  ) {}

  private async assertRefs(businessId: number, dto: SaveSalesOrderDto) {
    const [customer, location] = await Promise.all([
      this.prisma.contact.findFirst({
        where: { id: dto.contact_id, businessId, deletedAt: null, type: { in: ['customer', 'both'] } },
        select: { id: true },
      }),
      this.prisma.businessLocation.findFirst({ where: { id: dto.location_id, businessId, deletedAt: null }, select: { id: true } }),
    ]);
    if (!customer) throw new BadRequestException('Selected customer is invalid');
    if (!location) throw new BadRequestException('Selected business location is invalid');

    const variationIds = [...new Set(dto.sells.map((l) => l.variation_id))];
    const variations = await this.prisma.variation.findMany({
      where: { id: { in: variationIds }, deletedAt: null, product: { businessId } },
      select: { id: true, productId: true, defaultSellPrice: true },
    });
    if (variations.length !== variationIds.length) throw new BadRequestException('One or more products are invalid');

    const taxIds = [...new Set([dto.tax_rate_id, ...dto.sells.map((l) => l.tax_rate_id)].filter(Boolean) as number[])];
    if (taxIds.length) {
      const n = await this.prisma.taxRate.count({ where: { id: { in: taxIds }, businessId, deletedAt: null } });
      if (n !== taxIds.length) throw new BadRequestException('One or more tax rates are invalid');
    }
    const subUnitIds = [...new Set(dto.sells.map((l) => l.sub_unit_id).filter(Boolean) as number[])];
    if (subUnitIds.length) {
      const n = await this.prisma.unit.count({ where: { id: { in: subUnitIds }, businessId, deletedAt: null } });
      if (n !== subUnitIds.length) throw new BadRequestException('One or more units are invalid');
    }
    return new Map(variations.map((v) => [v.id, v]));
  }

  private async build(businessId: number, dto: SaveSalesOrderDto) {
    const variations = await this.assertRefs(businessId, dto);
    const taxIds = [...new Set([dto.tax_rate_id, ...dto.sells.map((l) => l.tax_rate_id)].filter(Boolean) as number[])];
    const taxRates = taxIds.length
      ? await this.prisma.taxRate.findMany({ where: { id: { in: taxIds } }, select: { id: true, amount: true } })
      : [];
    const taxPercent = new Map(taxRates.map((t) => [t.id, Number(t.amount)]));
    const subUnitIds = [...new Set(dto.sells.map((l) => l.sub_unit_id).filter(Boolean) as number[])];
    const subUnits = subUnitIds.length
      ? await this.prisma.unit.findMany({ where: { id: { in: subUnitIds } }, select: { id: true, baseUnitMultiplier: true } })
      : [];
    const multiplierOf = new Map(subUnits.map((u) => [u.id, Number(u.baseUnitMultiplier ?? 1) || 1]));

    const lines = dto.sells.map((line) => {
      const v = variations.get(line.variation_id)!;
      const multiplier = line.sub_unit_id ? (multiplierOf.get(line.sub_unit_id) ?? 1) : 1;
      const unitPrice = line.unit_price != null ? Number(line.unit_price) : Number(v.defaultSellPrice ?? 0) * multiplier;
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
        variationId: line.variation_id,
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
      money: {
        lineSubtotal: totals.lineSubtotal,
        taxAmount: totals.taxAmount,
        discountAmount: Number(dto.discount_amount) || 0,
        shippingCharges: Number(dto.shipping_charges) || 0,
        finalTotal: totals.finalTotal,
        additionalExpenses: (dto.additional_expenses ?? []).map((e) => ({ name: e.name, amount: round4(Number(e.amount) || 0) })),
      },
    };
  }

  private header(dto: SaveSalesOrderDto, money: Awaited<ReturnType<typeof this.build>>['money']) {
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
      roundOffAmount: Number(dto.round_off_amount) || 0,
      lineSubtotal: money.lineSubtotal,
      finalTotal: money.finalTotal,
      additionalNotes: blank(dto.additional_notes),
    };
  }

  async create(user: AccessPayload, dto: SaveSalesOrderDto) {
    const businessId = user.businessId as number;
    const { lines, money } = await this.build(businessId, dto);
    const refNo = blank(dto.ref_no) ?? (await this.refs.generate(businessId, 'sales_order', 'SO'));
    const clash = await this.prisma.transaction.findFirst({ where: { businessId, refNo }, select: { id: true } });
    if (clash) throw new ConflictException(`Reference number "${refNo}" is already used`);

    const created = await this.prisma.transaction.create({
      data: {
        businessId,
        type: 'SALES_ORDER',
        status: 'ORDERED',
        refNo,
        createdBy: user.sub,
        ...this.header(dto, money),
        sellLines: { create: lines.map((l) => l.data) },
      },
      select: { id: true },
    });

    await this.audit.record({
      model: 'SalesOrder',
      subjectId: created.id,
      name: refNo,
      action: 'created',
      after: { refNo, finalTotal: money.finalTotal, lines: lines.length },
    });
    return this.findOne(businessId, created.id);
  }

  async update(user: AccessPayload, id: number, dto: SaveSalesOrderDto) {
    const businessId = user.businessId as number;
    const existing = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'SALES_ORDER' },
      include: { sellLines: { select: { id: true, quantity: true, soQuantityInvoiced: true } } },
    });
    if (!existing) throw new NotFoundException('Sales order not found');

    const { lines, money } = await this.build(businessId, dto);
    const keptIds = lines.map((l) => l.input.sell_line_id).filter(Boolean) as number[];
    const removed = existing.sellLines.filter((l) => !keptIds.includes(l.id));
    for (const r of removed) {
      if (Number(r.soQuantityInvoiced) > 0) {
        throw new ConflictException('A line on this order has already been invoiced and cannot be removed');
      }
    }
    const byId = new Map(existing.sellLines.map((l) => [l.id, l]));
    for (const l of lines) {
      const prev = l.input.sell_line_id ? byId.get(l.input.sell_line_id) : undefined;
      if (prev && l.data.quantity < Number(prev.soQuantityInvoiced) - EPSILON) {
        throw new ConflictException(`A line cannot be reduced below the ${Number(prev.soQuantityInvoiced)} already invoiced`);
      }
    }

    if (blank(dto.ref_no) && blank(dto.ref_no) !== existing.refNo) {
      const clash = await this.prisma.transaction.findFirst({
        where: { businessId, refNo: blank(dto.ref_no) as string, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw new ConflictException(`Reference number "${dto.ref_no}" is already used`);
    }

    await this.prisma.$transaction(async (tx) => {
      if (removed.length) await tx.transactionSellLine.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
      for (const l of lines) {
        if (l.input.sell_line_id && byId.has(l.input.sell_line_id)) {
          await tx.transactionSellLine.update({ where: { id: l.input.sell_line_id }, data: l.data });
        } else {
          await tx.transactionSellLine.create({ data: { transactionId: id, ...l.data } });
        }
      }
      await tx.transaction.update({ where: { id }, data: { refNo: blank(dto.ref_no) ?? existing.refNo, ...this.header(dto, money) } });
      await this.recomputeStatus(tx, id);
    });

    await this.audit.record({
      model: 'SalesOrder',
      subjectId: id,
      name: existing.refNo,
      action: 'updated',
      before: { finalTotal: Number(existing.finalTotal) },
      after: { finalTotal: money.finalTotal },
    });
    return this.findOne(businessId, id);
  }

  async updateShipping(user: AccessPayload, id: number, dto: UpdateSoShippingDto) {
    const businessId = user.businessId as number;
    const existing = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'SALES_ORDER' },
      select: { id: true, refNo: true, shippingStatus: true },
    });
    if (!existing) throw new NotFoundException('Sales order not found');
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
      model: 'SalesOrder',
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
      where: { id, businessId, type: 'SALES_ORDER' },
      include: { sellLines: { select: { soQuantityInvoiced: true } } },
    });
    if (!existing) throw new NotFoundException('Sales order not found');
    const invoiced = existing.sellLines.reduce((s, l) => s + Number(l.soQuantityInvoiced), 0);
    if (invoiced > 0) {
      throw new ConflictException('This order has already been invoiced into a sale — delete those sales first');
    }
    await this.prisma.transaction.delete({ where: { id } });
    await this.audit.record({ model: 'SalesOrder', subjectId: id, name: existing.refNo, action: 'deleted', after: { refNo: existing.refNo } });
    return { success: true, msg: 'Sales order deleted' };
  }

  /** ordered / partial / completed from Σquantity vs Σso_quantity_invoiced. */
  private async recomputeStatus(tx: Prisma.TransactionClient, id: number) {
    const g = await tx.transactionSellLine.aggregate({
      where: { transactionId: id },
      _sum: { quantity: true, soQuantityInvoiced: true },
    });
    const ordered = Number(g._sum.quantity ?? 0);
    const invoiced = Number(g._sum.soQuantityInvoiced ?? 0);
    const status = invoiced <= EPSILON ? 'ORDERED' : ordered - invoiced <= EPSILON ? 'COMPLETED' : 'PARTIAL';
    await tx.transaction.update({ where: { id }, data: { status } });
  }

  // ── reads ─────────────────────────────────────────────
  async list(user: AccessPayload, query: SalesOrdersQueryDto) {
    const businessId = user.businessId as number;
    const s = query.search.trim();
    const and: Prisma.TransactionWhereInput[] = [{ businessId, type: 'SALES_ORDER' }];
    if (query.locationId) and.push({ locationId: query.locationId });
    if (query.contactId) and.push({ contactId: query.contactId });
    if (query.status) and.push({ status: STATUS[query.status] });
    if (query.shippingStatus) and.push({ shippingStatus: upper(query.shippingStatus) });
    if (query.dateFrom || query.dateTo) {
      and.push({ transactionDate: { ...(query.dateFrom ? { gte: query.dateFrom } : {}), ...(query.dateTo ? { lte: endOfDay(query.dateTo) } : {}) } });
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
    if (!(await this.ability.can(user, 'so.view_all'))) and.push({ createdBy: user.sub });

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
          sellLines: { select: { quantity: true, soQuantityInvoiced: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.aggregate({ where, _sum: { finalTotal: true } }),
    ]);

    return {
      data: rows.map((r) => {
        const ordered = r.sellLines.reduce((s2, l) => s2 + Number(l.quantity), 0);
        const invoiced = r.sellLines.reduce((s2, l) => s2 + Number(l.soQuantityInvoiced), 0);
        return {
          id: r.id,
          refNo: r.refNo,
          transactionDate: r.transactionDate,
          deliveryDate: r.deliveryDate,
          customer: r.contact?.name || r.contact?.supplierBusinessName || '',
          location: r.location.name,
          status: r.status.toLowerCase(),
          shippingStatus: r.shippingStatus?.toLowerCase() ?? null,
          finalTotal: Number(r.finalTotal),
          items: r.sellLines.length,
          quantityOrdered: round4(ordered),
          quantityRemaining: round4(ordered - invoiced),
        };
      }),
      total,
      totals: { finalTotal: round4(Number(totals._sum.finalTotal ?? 0)) },
    };
  }

  async findOne(businessId: number, id: number) {
    const p = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'SALES_ORDER' },
      include: {
        contact: { select: { id: true, name: true, supplierBusinessName: true, mobile: true } },
        location: { select: { id: true, name: true } },
        taxRate: { select: { id: true, name: true, amount: true } },
        sellLines: {
          orderBy: { id: 'asc' },
          include: { product: { select: { id: true, name: true } }, variation: { select: { id: true, name: true, subSku: true } } },
        },
      },
    });
    if (!p) throw new NotFoundException('Sales order not found');
    return {
      id: p.id,
      refNo: p.refNo,
      transactionDate: p.transactionDate,
      deliveryDate: p.deliveryDate,
      status: p.status.toLowerCase(),
      shippingStatus: p.shippingStatus?.toLowerCase() ?? null,
      contactId: p.contactId,
      customer: p.contact ? { id: p.contact.id, name: p.contact.name || p.contact.supplierBusinessName || '', mobile: p.contact.mobile } : null,
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
      roundOffAmount: Number(p.roundOffAmount),
      finalTotal: Number(p.finalTotal),
      payTermNumber: p.payTermNumber,
      payTermType: p.payTermType?.toLowerCase() ?? null,
      additionalNotes: p.additionalNotes ?? '',
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
        lineDiscountType: l.lineDiscountType?.toLowerCase() ?? null,
        lineDiscountAmount: Number(l.lineDiscountAmount),
        itemTax: Number(l.itemTax),
        unitPriceIncTax: Number(l.unitPriceIncTax),
        taxRateId: l.taxRateId,
        lineTotal: round4(Number(l.quantity) * Number(l.unitPriceIncTax)),
        quantityInvoiced: Number(l.soQuantityInvoiced),
        quantityRemaining: round4(Number(l.quantity) - Number(l.soQuantityInvoiced)),
      })),
    };
  }

  /** Open orders for a customer — what the sell form pulls from. */
  async openForCustomer(user: AccessPayload, contactId: number, locationId?: number) {
    const businessId = user.businessId as number;
    const rows = await this.prisma.transaction.findMany({
      where: { businessId, type: 'SALES_ORDER', contactId, status: { in: ['ORDERED', 'PARTIAL'] }, ...(locationId ? { locationId } : {}) },
      orderBy: { transactionDate: 'desc' },
      include: {
        sellLines: {
          orderBy: { id: 'asc' },
          include: { product: { select: { id: true, name: true } }, variation: { select: { id: true, name: true, subSku: true } } },
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
        lines: r.sellLines
          .filter((l) => round4(Number(l.quantity) - Number(l.soQuantityInvoiced)) > 0)
          .map((l) => ({
            id: l.id,
            productId: l.productId,
            variationId: l.variationId,
            product: l.product.name,
            variation: l.variation.name === 'DUMMY' ? '' : l.variation.name,
            sku: l.variation.subSku ?? '',
            quantityRemaining: round4(Number(l.quantity) - Number(l.soQuantityInvoiced)),
            unitPrice: Number(l.unitPrice),
            lineDiscountType: l.lineDiscountType?.toLowerCase() ?? null,
            lineDiscountAmount: Number(l.lineDiscountAmount),
            taxRateId: l.taxRateId,
          })),
      })),
    };
  }
}
