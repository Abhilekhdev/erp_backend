import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type TransactionStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { ReferenceNumberService } from '../../common/services/reference-number.service';
import { StockService } from '../../common/services/stock.service';
import { consumeLots, reverseLots } from '../../common/stock/lot-consumption';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../auth/token.service';
import { round4 } from '../purchases/purchase.calc';
import type { SaveTransferDto } from './dto/save-transfer.dto';

type UiStatus = 'pending' | 'in_transit' | 'completed';

/** UI status → the pair of stored statuses (destination becomes RECEIVED so its new lots are sellable). */
const STATUS_MAP: Record<UiStatus, { sell: TransactionStatus; purchase: TransactionStatus }> = {
  pending: { sell: 'PENDING', purchase: 'PENDING' },
  in_transit: { sell: 'IN_TRANSIT', purchase: 'IN_TRANSIT' },
  completed: { sell: 'COMPLETED', purchase: 'RECEIVED' },
};

interface ResolvedLine {
  productId: number;
  variationId: number;
  productVariationId: number;
  quantity: number;
  unitPrice: number;
  productName: string;
  enableStock: boolean;
}

@Injectable()
export class StockTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly refs: ReferenceNumberService,
    private readonly audit: AuditService,
  ) {}

  private async isLifo(businessId: number): Promise<boolean> {
    const b = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { accountingMethod: true },
    });
    return b?.accountingMethod === 'LIFO';
  }

  private uiStatusOf(sellStatus: TransactionStatus): UiStatus {
    if (sellStatus === 'COMPLETED') return 'completed';
    if (sellStatus === 'IN_TRANSIT') return 'in_transit';
    return 'pending';
  }

  // ── list ────────────────────────────────────────────────
  async list(businessId: number, query: Record<string, string>) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
    const where: Prisma.TransactionWhereInput = {
      businessId,
      type: 'SELL_TRANSFER',
      ...(query.search ? { refNo: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
        include: {
          location: { select: { name: true } },
          _count: { select: { purchaseLines: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    // The destination location lives on the paired purchase_transfer.
    const parentIds = rows.map((r) => r.id);
    const pairs = parentIds.length
      ? await this.prisma.transaction.findMany({
          where: { transferParentId: { in: parentIds }, type: 'PURCHASE_TRANSFER' },
          select: { transferParentId: true, location: { select: { name: true } }, _count: { select: { purchaseLines: true } } },
        })
      : [];
    const toBy = new Map(pairs.map((p) => [p.transferParentId, p]));

    return {
      data: rows.map((t) => ({
        id: t.id,
        refNo: t.refNo,
        transactionDate: t.transactionDate,
        fromLocation: t.location.name,
        toLocation: toBy.get(t.id)?.location.name ?? null,
        status: this.uiStatusOf(t.status),
        totalAmount: Number(t.finalTotal),
        lineCount: toBy.get(t.id)?._count.purchaseLines ?? t._count.purchaseLines,
      })),
      total,
    };
  }

  private async loadPair(businessId: number, sellTransferId: number) {
    const sell = await this.prisma.transaction.findFirst({
      where: { id: sellTransferId, businessId, type: 'SELL_TRANSFER' },
    });
    if (!sell) throw new NotFoundException('Stock transfer not found');
    const purchase = await this.prisma.transaction.findFirst({
      where: { transferParentId: sell.id, type: 'PURCHASE_TRANSFER' },
      include: { purchaseLines: true },
    });
    if (!purchase) throw new NotFoundException('Stock transfer is corrupt (missing destination)');
    return { sell, purchase };
  }

  async findOne(businessId: number, id: number) {
    const { sell, purchase } = await this.loadPair(businessId, id);
    const locSelect = { name: true, landmark: true, city: true, state: true, country: true, zipCode: true };
    const [fromLoc, toLoc, creator] = await Promise.all([
      this.prisma.businessLocation.findUnique({ where: { id: sell.locationId }, select: locSelect }),
      this.prisma.businessLocation.findUnique({ where: { id: purchase.locationId }, select: locSelect }),
      this.prisma.user.findUnique({
        where: { id: sell.createdBy },
        select: { surname: true, firstName: true, lastName: true },
      }),
    ]);
    const addr = (l: { landmark: string | null; city: string; state: string; country: string } | null) =>
      l ? [l.landmark, l.city, l.state, l.country].filter(Boolean).join(', ') : '';
    const creatorName = creator
      ? [creator.surname, creator.firstName, creator.lastName].filter(Boolean).join(' ').trim()
      : '';
    const variationIds = purchase.purchaseLines.map((l) => l.variationId);
    const variations = variationIds.length
      ? await this.prisma.variation.findMany({
          where: { id: { in: variationIds } },
          select: { id: true, name: true, subSku: true, product: { select: { name: true } } },
        })
      : [];
    const vById = new Map(variations.map((v) => [v.id, v]));

    return {
      id: sell.id,
      refNo: sell.refNo,
      transactionDate: sell.transactionDate,
      status: this.uiStatusOf(sell.status),
      fromLocationId: sell.locationId,
      fromLocation: fromLoc?.name ?? '',
      fromAddress: addr(fromLoc),
      toLocationId: purchase.locationId,
      toLocation: toLoc?.name ?? '',
      toAddress: addr(toLoc),
      shippingCharges: Number(sell.shippingCharges),
      additionalNotes: sell.additionalNotes,
      totalAmount: Number(sell.finalTotal),
      lineSubtotal: Number(sell.lineSubtotal),
      createdByName: creatorName,
      createdAt: sell.createdAt,
      lines: purchase.purchaseLines.map((l) => {
        const v = vById.get(l.variationId);
        return {
          productId: l.productId,
          variationId: l.variationId,
          productName: v?.product.name ?? '',
          variationName: v && v.name !== 'DUMMY' ? v.name : null,
          subSku: v?.subSku ?? null,
          quantity: Number(l.quantity),
          unitPrice: Number(l.purchasePrice),
          subtotal: round4(Number(l.quantity) * Number(l.purchasePrice)),
        };
      }),
    };
  }

  private async resolveLines(businessId: number, dto: SaveTransferDto): Promise<ResolvedLine[]> {
    const variationIds = [...new Set(dto.products.map((p) => p.variation_id))];
    const variations = await this.prisma.variation.findMany({
      where: { id: { in: variationIds }, product: { businessId } },
      select: {
        id: true,
        productId: true,
        productVariationId: true,
        product: { select: { name: true, enableStock: true } },
      },
    });
    const vById = new Map(variations.map((v) => [v.id, v]));
    return dto.products.map((p) => {
      const v = vById.get(p.variation_id);
      if (!v || v.productId !== p.product_id) throw new BadRequestException('One or more products are invalid');
      return {
        productId: p.product_id,
        variationId: p.variation_id,
        productVariationId: v.productVariationId,
        quantity: round4(Number(p.quantity)),
        unitPrice: round4(Number(p.unit_price ?? 0)),
        productName: v.product.name,
        enableStock: v.product.enableStock,
      };
    });
  }

  /** Post a completed transfer: consume FROM lots, add destination stock, record the source map. */
  private async applyStock(
    tx: Prisma.TransactionClient,
    businessId: number,
    sellId: number,
    fromLocationId: number,
    toLocationId: number,
    lines: ResolvedLine[],
    lifo: boolean,
  ) {
    const lotStockMap: { purchaseLineId: number; quantity: number }[] = [];
    for (const line of lines) {
      // Non-stock products carry no balance — GOURI skips them (enable_stock check), so the
      // destination line is kept but no lot is consumed and no stock moves.
      if (!line.enableStock) continue;
      const allocations = await consumeLots(tx, {
        businessId,
        locationId: fromLocationId,
        productId: line.productId,
        variationId: line.variationId,
        quantity: line.quantity,
        counter: 'quantitySold',
        lifo,
        productName: line.productName,
      });
      for (const a of allocations) lotStockMap.push({ purchaseLineId: a.purchaseLineId, quantity: a.quantity });

      await this.stock.move(tx, {
        locationId: fromLocationId,
        productId: line.productId,
        variationId: line.variationId,
        productVariationId: line.productVariationId,
        delta: -line.quantity,
      });
      await this.stock.move(tx, {
        locationId: toLocationId,
        productId: line.productId,
        variationId: line.variationId,
        productVariationId: line.productVariationId,
        delta: line.quantity,
      });
    }
    await tx.transaction.update({
      where: { id: sellId },
      data: { lotStockMap: lotStockMap as unknown as Prisma.InputJsonValue },
    });
  }

  // ── create ──────────────────────────────────────────────
  async create(user: AccessPayload, dto: SaveTransferDto) {
    const businessId = user.businessId as number;

    const locations = await this.prisma.businessLocation.findMany({
      where: { id: { in: [dto.location_id, dto.transfer_location_id] }, businessId, deletedAt: null },
      select: { id: true },
    });
    if (locations.length !== 2) throw new BadRequestException('One or both locations are invalid');

    const lines = await this.resolveLines(businessId, dto);
    const lineSubtotal = round4(lines.reduce((s, l) => s + round4(l.quantity * l.unitPrice), 0));
    const shipping = round4(Number(dto.shipping_charges ?? 0));
    const finalTotal = round4(lineSubtotal + shipping);

    const refNo = dto.ref_no?.trim() || (await this.refs.generate(businessId, 'stock_transfer', 'ST'));
    const clash = await this.prisma.transaction.findFirst({ where: { businessId, refNo }, select: { id: true } });
    if (clash) throw new ConflictException(`Reference number "${refNo}" is already used`);
    // Our schema requires a unique ref per row; the paired destination gets an internal suffix.
    const purchaseRefNo = `${refNo}/IN`;

    const status = STATUS_MAP[dto.status];
    const lifo = await this.isLifo(businessId);
    const date = dto.transaction_date ?? new Date();

    const id = await this.prisma.$transaction(async (tx) => {
      const common = {
        businessId,
        refNo,
        transactionDate: date,
        finalTotal,
        lineSubtotal,
        shippingCharges: shipping,
        additionalNotes: dto.additional_notes ?? null,
        paymentStatus: 'PAID' as const,
        createdBy: user.sub,
      };
      const sell = await tx.transaction.create({
        data: { ...common, type: 'SELL_TRANSFER', status: status.sell, locationId: dto.location_id },
      });
      const purchase = await tx.transaction.create({
        data: {
          ...common,
          refNo: purchaseRefNo,
          type: 'PURCHASE_TRANSFER',
          status: status.purchase,
          locationId: dto.transfer_location_id,
          transferParentId: sell.id,
        },
      });
      // Destination lots (become sellable once the transfer is completed → status RECEIVED).
      await tx.purchaseLine.createMany({
        data: lines.map((l) => ({
          transactionId: purchase.id,
          productId: l.productId,
          variationId: l.variationId,
          quantity: l.quantity,
          ppWithoutDiscount: l.unitPrice,
          purchasePrice: l.unitPrice,
          purchasePriceIncTax: l.unitPrice,
        })),
      });

      if (dto.status === 'completed') {
        await this.applyStock(tx, businessId, sell.id, dto.location_id, dto.transfer_location_id, lines, lifo);
      }
      return sell.id;
    });

    this.audit.log({
      action: 'created',
      subjectType: 'StockTransfer',
      subjectId: id,
      businessId,
      description: `Stock transfer "${refNo}" created (${dto.status})`,
      properties: { attributes: { refNo, finalTotal, status: dto.status } },
    });
    return this.findOne(businessId, id);
  }

  // ── status transition ───────────────────────────────────
  async updateStatus(user: AccessPayload, id: number, newStatus: UiStatus) {
    const businessId = user.businessId as number;
    const { sell, purchase } = await this.loadPair(businessId, id);
    const current = this.uiStatusOf(sell.status);
    if (current === newStatus) return this.findOne(businessId, id);
    if (current === 'completed') {
      throw new BadRequestException('A completed transfer cannot change status — delete it to reverse.');
    }

    const map = STATUS_MAP[newStatus];
    const lifo = await this.isLifo(businessId);

    await this.prisma.$transaction(async (tx) => {
      if (newStatus === 'completed') {
        const lines: ResolvedLine[] = await Promise.all(
          purchase.purchaseLines.map(async (l) => {
            const v = await tx.variation.findUnique({
              where: { id: l.variationId },
              select: { productVariationId: true, product: { select: { name: true, enableStock: true } } },
            });
            return {
              productId: l.productId,
              variationId: l.variationId,
              productVariationId: v?.productVariationId as number,
              quantity: Number(l.quantity),
              unitPrice: Number(l.purchasePrice),
              productName: v?.product.name ?? 'product',
              enableStock: v?.product.enableStock ?? false,
            };
          }),
        );
        await this.applyStock(tx, businessId, sell.id, sell.locationId, purchase.locationId, lines, lifo);
      }
      await tx.transaction.update({ where: { id: sell.id }, data: { status: map.sell } });
      await tx.transaction.update({ where: { id: purchase.id }, data: { status: map.purchase } });
    });

    this.audit.log({
      action: 'updated',
      subjectType: 'StockTransfer',
      subjectId: id,
      businessId,
      description: `Stock transfer "${sell.refNo}" moved to ${newStatus}`,
    });
    return this.findOne(businessId, id);
  }

  // ── delete (reverse) ────────────────────────────────────
  async remove(user: AccessPayload, id: number) {
    const businessId = user.businessId as number;
    const { sell, purchase } = await this.loadPair(businessId, id);
    const wasCompleted = sell.status === 'COMPLETED';

    if (wasCompleted) {
      // Block if any destination lot has already moved (sold/adjusted/returned/transferred on).
      const consumed = purchase.purchaseLines.some(
        (l) =>
          Number(l.quantitySold) > 0 ||
          Number(l.quantityAdjusted) > 0 ||
          Number(l.quantityReturned) > 0 ||
          Number(l.mfgQuantityUsed) > 0,
      );
      if (consumed) {
        throw new ConflictException('Destination stock from this transfer is already used — cannot delete.');
      }
    }

    const variationIds = purchase.purchaseLines.map((l) => l.variationId);
    const variations = variationIds.length
      ? await this.prisma.variation.findMany({
          where: { id: { in: variationIds } },
          select: { id: true, productVariationId: true },
        })
      : [];
    const pvById = new Map(variations.map((v) => [v.id, v.productVariationId]));
    const sourceMap = (sell.lotStockMap as unknown as { purchaseLineId: number; quantity: number }[] | null) ?? [];

    await this.prisma.$transaction(async (tx) => {
      if (wasCompleted) {
        // Give the source lots their quantity back, and undo both aggregate moves.
        await reverseLots(tx, sourceMap, 'quantitySold');
        for (const l of purchase.purchaseLines) {
          const pv = pvById.get(l.variationId) as number;
          await this.stock.move(tx, {
            locationId: sell.locationId,
            productId: l.productId,
            variationId: l.variationId,
            productVariationId: pv,
            delta: Number(l.quantity),
          }); // give source back
          await this.stock.move(tx, {
            locationId: purchase.locationId,
            productId: l.productId,
            variationId: l.variationId,
            productVariationId: pv,
            delta: -Number(l.quantity),
          }); // remove destination
        }
      }
      await tx.transaction.delete({ where: { id: purchase.id } }); // destination lots cascade
      await tx.transaction.delete({ where: { id: sell.id } });
    });

    this.audit.log({
      action: 'deleted',
      subjectType: 'StockTransfer',
      subjectId: id,
      businessId,
      description: `Stock transfer "${sell.refNo}" deleted`,
    });
    return { success: true, msg: 'Stock transfer deleted' };
  }

  async meta(businessId: number) {
    const locations = await this.prisma.businessLocation.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return { locations };
  }
}
