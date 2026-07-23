import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { ReferenceNumberService } from '../../common/services/reference-number.service';
import { StockService } from '../../common/services/stock.service';
import { consumeLots, reverseLots, type LotAllocation } from '../../common/stock/lot-consumption';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../auth/token.service';
import { round4 } from '../purchases/purchase.calc';
import type { AdjustmentsQuery, SaveAdjustmentDto } from './dto/save-adjustment.dto';

@Injectable()
export class StockAdjustmentsService {
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

  // ── list ────────────────────────────────────────────────
  async list(businessId: number, query: AdjustmentsQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
    const where: Prisma.TransactionWhereInput = {
      businessId,
      type: 'STOCK_ADJUSTMENT',
      ...(query.locationId ? { locationId: Number(query.locationId) } : {}),
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
          adjustmentType: { select: { name: true } },
          _count: { select: { stockAdjustmentLines: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return {
      data: rows.map((t) => ({
        id: t.id,
        refNo: t.refNo,
        transactionDate: t.transactionDate,
        location: t.location.name,
        adjustmentType: t.adjustmentType?.name ?? null,
        totalAmount: Number(t.finalTotal),
        totalAmountRecovered: Number(t.totalAmountRecovered ?? 0),
        lineCount: t._count.stockAdjustmentLines,
      })),
      total,
    };
  }

  async findOne(businessId: number, id: number) {
    const t = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'STOCK_ADJUSTMENT' },
      include: {
        location: { select: { id: true, name: true } },
        adjustmentType: { select: { id: true, name: true } },
        stockAdjustmentLines: true,
      },
    });
    if (!t) throw new NotFoundException('Stock adjustment not found');

    const variationIds = t.stockAdjustmentLines.map((l) => l.variationId);
    const variations = variationIds.length
      ? await this.prisma.variation.findMany({
          where: { id: { in: variationIds } },
          select: { id: true, name: true, subSku: true, product: { select: { name: true } } },
        })
      : [];
    const vById = new Map(variations.map((v) => [v.id, v]));

    return {
      id: t.id,
      refNo: t.refNo,
      transactionDate: t.transactionDate,
      locationId: t.locationId,
      location: t.location.name,
      adjustmentTypeId: t.adjustmentTypeId,
      adjustmentType: t.adjustmentType?.name ?? null,
      totalAmount: Number(t.finalTotal),
      totalAmountRecovered: Number(t.totalAmountRecovered ?? 0),
      additionalNotes: t.additionalNotes,
      lines: t.stockAdjustmentLines.map((l) => {
        const v = vById.get(l.variationId);
        return {
          id: l.id,
          productId: l.productId,
          variationId: l.variationId,
          productName: v?.product.name ?? '',
          variationName: v && v.name !== 'DUMMY' ? v.name : null,
          subSku: v?.subSku ?? null,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          subtotal: round4(Number(l.quantity) * Number(l.unitPrice)),
        };
      }),
    };
  }

  // ── create ──────────────────────────────────────────────
  async create(user: AccessPayload, dto: SaveAdjustmentDto) {
    const businessId = user.businessId as number;

    const location = await this.prisma.businessLocation.findFirst({
      where: { id: dto.location_id, businessId, deletedAt: null },
      select: { id: true },
    });
    if (!location) throw new BadRequestException('Selected business location is invalid');

    if (dto.adjustment_type_id) {
      const wt = await this.prisma.wastageType.findFirst({
        where: { id: dto.adjustment_type_id, businessId, deletedAt: null },
        select: { id: true },
      });
      if (!wt) throw new BadRequestException('Selected adjustment type is invalid');
    }

    // Resolve productVariationId + validate every line belongs to the business.
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
    for (const p of dto.products) {
      const v = vById.get(p.variation_id);
      if (!v || v.productId !== p.product_id) {
        throw new BadRequestException('One or more products are invalid');
      }
    }

    const refNo = dto.ref_no?.trim() || (await this.refs.generate(businessId, 'stock_adjustment', 'SA'));
    const clash = await this.prisma.transaction.findFirst({ where: { businessId, refNo }, select: { id: true } });
    if (clash) throw new ConflictException(`Reference number "${refNo}" is already used`);

    const finalTotal = round4(
      dto.products.reduce((s, p) => s + round4(Number(p.quantity) * Number(p.unit_price ?? 0)), 0),
    );
    const lifo = await this.isLifo(businessId);

    const id = await this.prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          businessId,
          locationId: dto.location_id,
          type: 'STOCK_ADJUSTMENT',
          status: 'FINAL', // adjustments post immediately (GOURI writes no status; we canonicalise)
          refNo,
          transactionDate: dto.transaction_date ?? new Date(),
          adjustmentTypeId: dto.adjustment_type_id ?? null,
          totalAmountRecovered: dto.total_amount_recovered ?? 0,
          finalTotal,
          lineSubtotal: finalTotal,
          additionalNotes: dto.additional_notes ?? null,
          paymentStatus: 'PAID',
          createdBy: user.sub,
        },
      });

      for (const p of dto.products) {
        const v = vById.get(p.variation_id)!;
        const line = await tx.stockAdjustmentLine.create({
          data: {
            transactionId: created.id,
            productId: p.product_id,
            variationId: p.variation_id,
            quantity: round4(Number(p.quantity)),
            unitPrice: round4(Number(p.unit_price ?? 0)),
            lotNoLineId: p.lot_no_line_id ?? null,
          },
        });

        // Products with stock tracking off carry no balance — GOURI skips them (mapPurchaseSell
        // `continue` on enable_stock != 1), so the line is recorded but no stock moves.
        if (!v.product.enableStock) continue;

        // Consume purchase lots (FIFO/LIFO) — this is what refuses an over-adjustment.
        const allocations = await consumeLots(tx, {
          businessId,
          locationId: dto.location_id,
          productId: p.product_id,
          variationId: p.variation_id,
          quantity: Number(p.quantity),
          counter: 'quantityAdjusted',
          lifo,
          lotNoLineId: p.lot_no_line_id ?? null,
          productName: v.product.name,
        });
        await tx.stockAdjustmentLine.update({
          where: { id: line.id },
          data: { lotAllocations: allocations as unknown as Prisma.InputJsonValue },
        });

        // Reduce the location's running balance.
        await this.stock.move(tx, {
          locationId: dto.location_id,
          productId: p.product_id,
          variationId: p.variation_id,
          productVariationId: v.productVariationId,
          delta: -round4(Number(p.quantity)),
        });
      }
      return created.id;
    });

    this.audit.log({
      action: 'created',
      subjectType: 'StockAdjustment',
      subjectId: id,
      businessId,
      description: `Stock adjustment "${refNo}" created`,
      properties: { attributes: { refNo, finalTotal, lines: dto.products.length } },
    });
    return this.findOne(businessId, id);
  }

  // ── delete (reverse stock) ──────────────────────────────
  async remove(user: AccessPayload, id: number) {
    const businessId = user.businessId as number;
    const t = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'STOCK_ADJUSTMENT' },
      include: { stockAdjustmentLines: true },
    });
    if (!t) throw new NotFoundException('Stock adjustment not found');

    // Resolve productVariationId for the stock give-back.
    const variationIds = t.stockAdjustmentLines.map((l) => l.variationId);
    const variations = variationIds.length
      ? await this.prisma.variation.findMany({
          where: { id: { in: variationIds } },
          select: { id: true, productVariationId: true },
        })
      : [];
    const pvById = new Map(variations.map((v) => [v.id, v.productVariationId]));

    await this.prisma.$transaction(async (tx) => {
      for (const line of t.stockAdjustmentLines) {
        const allocations = (line.lotAllocations as unknown as LotAllocation[] | null) ?? [];
        await reverseLots(tx, allocations, 'quantityAdjusted');
        await this.stock.move(tx, {
          locationId: t.locationId,
          productId: line.productId,
          variationId: line.variationId,
          productVariationId: pvById.get(line.variationId) as number,
          delta: round4(Number(line.quantity)),
        });
      }
      await tx.transaction.delete({ where: { id } }); // lines cascade
    });

    this.audit.log({
      action: 'deleted',
      subjectType: 'StockAdjustment',
      subjectId: id,
      businessId,
      description: `Stock adjustment "${t.refNo}" deleted`,
    });
    return { success: true, msg: 'Stock adjustment deleted' };
  }

  // ── form meta ───────────────────────────────────────────
  async meta(businessId: number) {
    const [locations, wastageTypes] = await Promise.all([
      this.prisma.businessLocation.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.wastageType.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { locations, wastageTypes };
  }
}
