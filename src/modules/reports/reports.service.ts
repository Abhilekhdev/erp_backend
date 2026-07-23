import { Injectable } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { ReportQueryDto } from './dto/report-query.dto';

/** Prisma Decimal | null → number. */
const num = (v: Prisma.Decimal | number | null | undefined): number => (v == null ? 0 : Number(v));
const round = (n: number): number => Math.round(n * 100) / 100;
const contactName = (c: {
  name: string | null;
  supplierBusinessName: string | null;
  firstName: string | null;
  lastName: string | null;
}): string =>
  c.supplierBusinessName ||
  c.name ||
  [c.firstName, c.lastName].filter(Boolean).join(' ').trim() ||
  'Unnamed';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── shared filter builder ─────────────────────────────────────────────
  /** transactions where-clause from the shared filters (business + optional type/location/date). */
  private txWhere(
    businessId: number,
    q: ReportQueryDto,
    type?: TransactionType | TransactionType[],
  ): Prisma.TransactionWhereInput {
    const where: Prisma.TransactionWhereInput = { businessId };
    if (type) where.type = Array.isArray(type) ? { in: type } : type;
    if (q.locationId) where.locationId = q.locationId;
    if (q.startDate || q.endDate) {
      where.transactionDate = {};
      if (q.startDate) where.transactionDate.gte = new Date(`${q.startDate}T00:00:00.000Z`);
      if (q.endDate) where.transactionDate.lte = new Date(`${q.endDate}T23:59:59.999Z`);
    }
    return where;
  }

  /** Sum of final_total for transactions of a type under the current filters. */
  private async sumFinal(businessId: number, q: ReportQueryDto, type: TransactionType): Promise<number> {
    const r = await this.prisma.transaction.aggregate({
      where: this.txWhere(businessId, q, type),
      _sum: { finalTotal: true },
      _count: true,
    });
    return num(r._sum.finalTotal);
  }

  /** Total paid (payments) for a set of transaction types under the current filters. */
  private async sumPaid(businessId: number, q: ReportQueryDto, types: TransactionType[]): Promise<number> {
    const r = await this.prisma.transactionPayment.aggregate({
      where: {
        businessId,
        transaction: this.txWhere(businessId, q, types),
      },
      _sum: { amount: true },
    });
    return num(r._sum.amount);
  }

  // ── META (filter dropdowns) ───────────────────────────────────────────
  async meta(businessId: number) {
    const [locations, categories, brands, units, taxRates, users, suppliers, customers] =
      await Promise.all([
        this.prisma.businessLocation.findMany({
          where: { businessId, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.category.findMany({
          where: { businessId, deletedAt: null, categoryType: 'product' },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.brand.findMany({
          where: { businessId, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.unit.findMany({
          where: { businessId, deletedAt: null },
          select: { id: true, actualName: true, shortName: true },
          orderBy: { actualName: 'asc' },
        }),
        this.prisma.taxRate.findMany({
          where: { businessId, deletedAt: null },
          select: { id: true, name: true, amount: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.user.findMany({
          where: { businessId, deletedAt: null },
          select: { id: true, surname: true, firstName: true, lastName: true },
          orderBy: { firstName: 'asc' },
        }),
        this.prisma.contact.findMany({
          where: { businessId, deletedAt: null, type: { in: ['supplier', 'both'] } },
          select: { id: true, name: true, supplierBusinessName: true, firstName: true, lastName: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.contact.findMany({
          where: { businessId, deletedAt: null, type: { in: ['customer', 'both'] } },
          select: { id: true, name: true, supplierBusinessName: true, firstName: true, lastName: true },
          orderBy: { name: 'asc' },
        }),
      ]);

    return {
      locations,
      categories,
      brands,
      units: units.map((u) => ({ id: u.id, name: u.actualName + (u.shortName ? ` (${u.shortName})` : '') })),
      taxRates: taxRates.map((t) => ({ id: t.id, name: `${t.name} (${num(t.amount)}%)` })),
      users: users.map((u) => ({
        id: u.id,
        name: [u.surname, u.firstName, u.lastName].filter(Boolean).join(' ').trim(),
      })),
      suppliers: suppliers.map((c) => ({ id: c.id, name: contactName(c) })),
      customers: customers.map((c) => ({ id: c.id, name: contactName(c) })),
    };
  }

  // ── 1. PROFIT / LOSS ──────────────────────────────────────────────────
  /**
   * Headline P&L. Gross profit is computed from the FIFO cost allocations
   * (`SellPurchaseAllocation`) — the port of GOURI's `transaction_sell_lines_purchase_lines`:
   * revenue and cost use the SAME allocated quantity, so returns net out on both sides.
   */
  async profitLoss(businessId: number, q: ReportQueryDto) {
    const [totalSell, sellReturn, totalPurchase, purchaseReturn, totalExpense] = await Promise.all([
      this.sumFinal(businessId, q, TransactionType.SELL),
      this.sumFinal(businessId, q, TransactionType.SELL_RETURN),
      this.sumFinal(businessId, q, TransactionType.PURCHASE),
      this.sumFinal(businessId, q, TransactionType.PURCHASE_RETURN),
      this.sumFinal(businessId, q, TransactionType.EXPENSE),
    ]);

    // Gross profit from allocations scoped to sells inside the window/location.
    const allocations = await this.prisma.sellPurchaseAllocation.findMany({
      where: {
        sellLine: { transaction: this.txWhere(businessId, q, TransactionType.SELL) },
      },
      select: {
        quantity: true,
        qtyReturned: true,
        sellLine: { select: { unitPriceIncTax: true } },
        purchaseLine: { select: { purchasePriceIncTax: true } },
      },
    });

    let revenue = 0;
    let cost = 0;
    for (const a of allocations) {
      const qty = num(a.quantity) - num(a.qtyReturned);
      revenue += qty * num(a.sellLine.unitPriceIncTax);
      cost += qty * num(a.purchaseLine.purchasePriceIncTax);
    }
    const grossProfit = revenue - cost;
    const netProfit = grossProfit - totalExpense;

    return {
      totalSell: round(totalSell),
      sellReturn: round(sellReturn),
      totalPurchase: round(totalPurchase),
      purchaseReturn: round(purchaseReturn),
      totalExpense: round(totalExpense),
      grossProfit: round(grossProfit),
      netProfit: round(netProfit),
    };
  }

  // ── 2. PURCHASE & SALE ────────────────────────────────────────────────
  async purchaseSale(businessId: number, q: ReportQueryDto) {
    const [purchase, purchaseReturn, sell, sellReturn, purchasePaid, sellPaid] = await Promise.all([
      this.sumFinal(businessId, q, TransactionType.PURCHASE),
      this.sumFinal(businessId, q, TransactionType.PURCHASE_RETURN),
      this.sumFinal(businessId, q, TransactionType.SELL),
      this.sumFinal(businessId, q, TransactionType.SELL_RETURN),
      this.sumPaid(businessId, q, [TransactionType.PURCHASE]),
      this.sumPaid(businessId, q, [TransactionType.SELL]),
    ]);

    return {
      purchase: {
        total: round(purchase),
        paid: round(purchasePaid),
        due: round(purchase - purchasePaid),
        returnTotal: round(purchaseReturn),
      },
      sale: {
        total: round(sell),
        paid: round(sellPaid),
        due: round(sell - sellPaid),
        returnTotal: round(sellReturn),
      },
    };
  }

  // ── 3. TAX REPORT ─────────────────────────────────────────────────────
  async tax(businessId: number, q: ReportQueryDto) {
    const [outSell, inPurchase] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: this.txWhere(businessId, q, TransactionType.SELL),
        _sum: { taxAmount: true },
      }),
      this.prisma.transaction.aggregate({
        where: this.txWhere(businessId, q, TransactionType.PURCHASE),
        _sum: { taxAmount: true },
      }),
    ]);
    const outputTax = num(outSell._sum.taxAmount);
    const inputTax = num(inPurchase._sum.taxAmount);

    return {
      outputTax: round(outputTax), // tax collected on sales
      inputTax: round(inputTax), // tax paid on purchases
      taxDue: round(outputTax - inputTax),
    };
  }

  // ── 4. STOCK REPORT (product/inventory, no transactions) ──────────────
  async stock(businessId: number, q: ReportQueryDto) {
    const variations = await this.prisma.variation.findMany({
      where: {
        deletedAt: null,
        product: {
          businessId,
          isInactive: false,
          enableStock: true,
          ...(q.categoryId ? { categoryId: q.categoryId } : {}),
          ...(q.brandId ? { brandId: q.brandId } : {}),
          ...(q.unitId ? { unitId: q.unitId } : {}),
        },
      },
      select: {
        id: true,
        name: true,
        subSku: true,
        defaultPurchasePrice: true,
        defaultSellPrice: true,
        sellPriceIncTax: true,
        product: { select: { name: true, sku: true } },
        stockLevels: {
          where: q.locationId ? { locationId: q.locationId } : {},
          select: { qtyAvailable: true },
        },
      },
      orderBy: { product: { name: 'asc' } },
    });

    let totalStockValue = 0;
    let totalPotential = 0;
    const rows = variations.map((v) => {
      const stock = v.stockLevels.reduce((s, d) => s + num(d.qtyAvailable), 0);
      const purchasePrice = num(v.defaultPurchasePrice);
      const sellPrice = num(v.sellPriceIncTax) || num(v.defaultSellPrice);
      const stockValue = stock * purchasePrice;
      const potential = stock * sellPrice;
      totalStockValue += stockValue;
      totalPotential += potential;
      return {
        product: v.product.name + (v.name && v.name !== 'DUMMY' ? ` — ${v.name}` : ''),
        sku: v.subSku || v.product.sku,
        currentStock: round(stock),
        unitPurchasePrice: round(purchasePrice),
        unitSellPrice: round(sellPrice),
        stockValue: round(stockValue),
        potentialValue: round(potential),
      };
    });

    return {
      totals: {
        stockValueByPurchase: round(totalStockValue),
        stockValueBySale: round(totalPotential),
        potentialProfit: round(totalPotential - totalStockValue),
      },
      data: rows,
    };
  }

  // ── 5. TRENDING PRODUCTS ──────────────────────────────────────────────
  async trending(businessId: number, q: ReportQueryDto) {
    // Sum sold quantity per product from sell lines whose transaction matches the filters.
    const grouped = await this.prisma.transactionSellLine.groupBy({
      by: ['productId'],
      where: {
        transaction: this.txWhere(businessId, q, TransactionType.SELL),
        product: {
          ...(q.categoryId ? { categoryId: q.categoryId } : {}),
          ...(q.brandId ? { brandId: q.brandId } : {}),
          ...(q.unitId ? { unitId: q.unitId } : {}),
        },
      },
      _sum: { quantity: true, quantityReturned: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: q.limit,
    });

    const products = await this.prisma.product.findMany({
      where: { id: { in: grouped.map((g) => g.productId) } },
      select: { id: true, name: true, sku: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    return {
      data: grouped.map((g) => {
        const p = byId.get(g.productId);
        const soldQty = num(g._sum.quantity) - num(g._sum.quantityReturned);
        return {
          product: p?.name ?? `#${g.productId}`,
          sku: p?.sku ?? '',
          unitsSold: round(soldQty),
        };
      }),
    };
  }

  // ── 6. ITEMS REPORT (purchased vs sold vs on-hand, per product) ───────
  async items(businessId: number, q: ReportQueryDto) {
    const [purchased, sold] = await Promise.all([
      this.prisma.purchaseLine.groupBy({
        by: ['productId'],
        where: { transaction: this.txWhere(businessId, q, TransactionType.PURCHASE) },
        _sum: { quantity: true },
      }),
      this.prisma.transactionSellLine.groupBy({
        by: ['productId'],
        where: { transaction: this.txWhere(businessId, q, TransactionType.SELL) },
        _sum: { quantity: true, quantityReturned: true },
      }),
    ]);

    const purchasedBy = new Map(purchased.map((p) => [p.productId, num(p._sum.quantity)]));
    const soldBy = new Map(
      sold.map((s) => [s.productId, num(s._sum.quantity) - num(s._sum.quantityReturned)]),
    );
    const productIds = [...new Set([...purchasedBy.keys(), ...soldBy.keys()])];
    if (productIds.length === 0) return { data: [] };

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, businessId, isInactive: false },
      select: {
        id: true,
        name: true,
        sku: true,
        variations: {
          where: { deletedAt: null },
          select: {
            stockLevels: {
              where: q.locationId ? { locationId: q.locationId } : {},
              select: { qtyAvailable: true },
            },
          },
        },
      },
    });

    return {
      data: products
        .map((p) => {
          const stock = p.variations.reduce(
            (s, v) => s + v.stockLevels.reduce((a, d) => a + num(d.qtyAvailable), 0),
            0,
          );
          return {
            product: p.name,
            sku: p.sku,
            totalPurchased: round(purchasedBy.get(p.id) ?? 0),
            totalSold: round(soldBy.get(p.id) ?? 0),
            currentStock: round(stock),
          };
        })
        .sort((a, b) => b.totalSold - a.totalSold),
    };
  }

  // ── 7. EXPENSE REPORT (by category) ───────────────────────────────────
  async expense(businessId: number, q: ReportQueryDto) {
    const grouped = await this.prisma.transaction.groupBy({
      by: ['expenseCategoryId'],
      where: this.txWhere(businessId, q, TransactionType.EXPENSE),
      _sum: { finalTotal: true },
      _count: true,
    });

    const catIds = grouped.map((g) => g.expenseCategoryId).filter((id): id is number => id != null);
    const cats = catIds.length
      ? await this.prisma.expenseCategory.findMany({
          where: { id: { in: catIds } },
          select: { id: true, name: true },
        })
      : [];
    const catName = new Map(cats.map((c) => [c.id, c.name]));

    const total = grouped.reduce((s, g) => s + num(g._sum.finalTotal), 0);
    return {
      total: round(total),
      data: grouped
        .map((g) => ({
          category: g.expenseCategoryId ? (catName.get(g.expenseCategoryId) ?? 'Unknown') : 'Uncategorized',
          count: g._count,
          amount: round(num(g._sum.finalTotal)),
        }))
        .sort((a, b) => b.amount - a.amount),
    };
  }

  // ── 8. SALES REPRESENTATIVE (per user) ────────────────────────────────
  /**
   * Per-user totals — sells vs expenses they created, and the net. GOURI additionally shows
   * commission; there is no commission-agent field on transactions in this schema yet, so that
   * column is omitted rather than fabricated.
   */
  async salesRep(businessId: number, q: ReportQueryDto) {
    const userFilter = q.userId ? { createdBy: q.userId } : {};
    const [sells, expenses] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['createdBy'],
        where: { ...this.txWhere(businessId, q, TransactionType.SELL), ...userFilter },
        _sum: { finalTotal: true },
        _count: true,
      }),
      this.prisma.transaction.groupBy({
        by: ['createdBy'],
        where: { ...this.txWhere(businessId, q, TransactionType.EXPENSE), ...userFilter },
        _sum: { finalTotal: true },
      }),
    ]);

    const sellBy = new Map(sells.map((s) => [s.createdBy, { total: num(s._sum.finalTotal), count: s._count }]));
    const expBy = new Map(expenses.map((e) => [e.createdBy, num(e._sum.finalTotal)]));
    const userIds = [...new Set([...sellBy.keys(), ...expBy.keys()])];
    if (userIds.length === 0) return { data: [] };

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, businessId },
      select: { id: true, surname: true, firstName: true, lastName: true },
    });

    return {
      data: users
        .map((u) => {
          const sell = sellBy.get(u.id) ?? { total: 0, count: 0 };
          const exp = expBy.get(u.id) ?? 0;
          return {
            user: [u.surname, u.firstName, u.lastName].filter(Boolean).join(' ').trim(),
            totalSell: round(sell.total),
            sellCount: sell.count,
            totalExpense: round(exp),
            net: round(sell.total - exp),
          };
        })
        .sort((a, b) => b.totalSell - a.totalSell),
    };
  }

  // ── 9. CUSTOMER & SUPPLIER ────────────────────────────────────────────
  /**
   * Per-contact totals. For suppliers = purchases; for customers = sells. Paid comes from the
   * payments on those transactions; due = total − paid.
   */
  async customerSupplier(businessId: number, q: ReportQueryDto) {
    const isSupplier = q.contactType === 'supplier';
    const txType = isSupplier ? TransactionType.PURCHASE : TransactionType.SELL;

    const grouped = await this.prisma.transaction.groupBy({
      by: ['contactId'],
      where: { ...this.txWhere(businessId, q, txType), contactId: { not: null } },
      _sum: { finalTotal: true },
      _count: true,
    });
    if (grouped.length === 0) return { contactType: q.contactType ?? 'customer', data: [] };

    const contactIds = grouped.map((g) => g.contactId).filter((id): id is number => id != null);
    const [contacts, payments] = await Promise.all([
      this.prisma.contact.findMany({
        where: { id: { in: contactIds }, businessId },
        select: { id: true, name: true, supplierBusinessName: true, firstName: true, lastName: true },
      }),
      this.prisma.transactionPayment.groupBy({
        by: ['transactionId'],
        where: {
          businessId,
          transaction: { ...this.txWhere(businessId, q, txType), contactId: { in: contactIds } },
        },
        _sum: { amount: true },
      }),
    ]);

    // Roll payments up from transaction → contact.
    const txContact = await this.prisma.transaction.findMany({
      where: { businessId, type: txType, contactId: { in: contactIds } },
      select: { id: true, contactId: true },
    });
    const txToContact = new Map(txContact.map((t) => [t.id, t.contactId]));
    const paidByContact = new Map<number, number>();
    for (const p of payments) {
      const cid = p.transactionId != null ? txToContact.get(p.transactionId) : null;
      if (cid != null) paidByContact.set(cid, (paidByContact.get(cid) ?? 0) + num(p._sum.amount));
    }

    const byId = new Map(contacts.map((c) => [c.id, c]));
    return {
      contactType: q.contactType ?? 'customer',
      data: grouped
        .filter((g) => g.contactId != null)
        .map((g) => {
          const cid = g.contactId as number;
          const total = num(g._sum.finalTotal);
          const paid = paidByContact.get(cid) ?? 0;
          const c = byId.get(cid);
          return {
            contact: c ? contactName(c) : `#${cid}`,
            documents: g._count,
            total: round(total),
            paid: round(paid),
            due: round(total - paid),
          };
        })
        .sort((a, b) => b.total - a.total),
    };
  }
}
