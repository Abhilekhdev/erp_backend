import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { AbilityService } from '../../common/services/ability.service';
import { ReferenceNumberService } from '../../common/services/reference-number.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../auth/token.service';
import { remainingOf } from '../purchases/draw-down';
import { round4 } from '../purchases/purchase.calc';
import type { RequisitionsQueryDto, SaveRequisitionDto } from './dto/requisition.dto';

const STATUS = { ordered: 'ORDERED', partial: 'PARTIAL', completed: 'COMPLETED' } as const;
const endOfDay = (d: Date) => new Date(new Date(d).setHours(23, 59, 59, 999));

/**
 * Purchase requisitions — "these locations need these products".
 *
 * The document carries no supplier and no money: it exists to be turned into a purchase order.
 * Its status is derived entirely from how much of it has been drawn into orders; see
 * `purchases/draw-down.ts`.
 *
 * GOURI has no edit for this type at all (`edit()`/`update()` are empty stubs and there is no
 * `purchase_requisition.update` permission), so neither do we — a requisition is deleted and
 * re-raised. What we do NOT copy is its delete, which happily removes a requisition that orders
 * have already been raised against and orphans their counters.
 */
@Injectable()
export class PurchaseRequisitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refs: ReferenceNumberService,
    private readonly audit: AuditService,
    private readonly ability: AbilityService,
  ) {}

  private async assertRefs(businessId: number, dto: SaveRequisitionDto) {
    const location = await this.prisma.businessLocation.findFirst({
      where: { id: dto.location_id, businessId, deletedAt: null },
      select: { id: true },
    });
    if (!location) throw new BadRequestException('Selected business location is invalid');

    const variationIds = [...new Set(dto.requisitions.map((r) => r.variation_id))];
    const variations = await this.prisma.variation.findMany({
      where: { id: { in: variationIds }, deletedAt: null, product: { businessId } },
      select: { id: true, productId: true },
    });
    if (variations.length !== variationIds.length) {
      throw new BadRequestException('One or more products are invalid');
    }
    return new Map(variations.map((v) => [v.id, v]));
  }

  async create(user: AccessPayload, dto: SaveRequisitionDto) {
    const businessId = user.businessId as number;
    const variations = await this.assertRefs(businessId, dto);

    const refNo = dto.ref_no?.trim() || (await this.refs.generate(businessId, 'purchase_requisition', 'REQ'));
    const clash = await this.prisma.transaction.findFirst({
      where: { businessId, refNo },
      select: { id: true },
    });
    if (clash) throw new ConflictException(`Reference number "${refNo}" is already used`);

    const created = await this.prisma.transaction.create({
      data: {
        businessId,
        locationId: dto.location_id,
        type: 'PURCHASE_REQUISITION',
        status: 'ORDERED',
        refNo,
        // GOURI forces `now()` here and then offers a date-range filter on it; a requisition can
        // legitimately be raised for an earlier day, so the form's date is honoured.
        transactionDate: dto.transaction_date ? new Date(dto.transaction_date) : new Date(),
        deliveryDate: dto.delivery_date ? new Date(dto.delivery_date) : null,
        additionalNotes: dto.additional_notes ?? null,
        createdBy: user.sub,
        purchaseLines: {
          create: dto.requisitions.map((r) => ({
            productId: variations.get(r.variation_id)!.productId,
            variationId: r.variation_id,
            quantity: round4(r.quantity),
            secondaryUnitQuantity: round4(Number(r.secondary_unit_quantity) || 0),
          })),
        },
      },
      select: { id: true, refNo: true },
    });

    await this.audit.record({
      model: 'PurchaseRequisition',
      subjectId: created.id,
      name: created.refNo,
      action: 'created',
      after: { refNo: created.refNo, lines: dto.requisitions.length },
    });

    return this.findOne(businessId, created.id);
  }

  async list(user: AccessPayload, query: RequisitionsQueryDto) {
    const businessId = user.businessId as number;
    const s = query.search.trim();

    const and: Prisma.TransactionWhereInput[] = [{ businessId, type: 'PURCHASE_REQUISITION' }];
    if (query.locationId) and.push({ locationId: query.locationId });
    if (query.status) and.push({ status: STATUS[query.status] });
    if (s) and.push({ refNo: { contains: s, mode: 'insensitive' } });
    if (query.dateFrom || query.dateTo) {
      and.push({
        transactionDate: {
          ...(query.dateFrom ? { gte: query.dateFrom } : {}),
          ...(query.dateTo ? { lte: endOfDay(query.dateTo) } : {}),
        },
      });
    }
    if (query.requiredFrom || query.requiredTo) {
      and.push({
        deliveryDate: {
          ...(query.requiredFrom ? { gte: query.requiredFrom } : {}),
          ...(query.requiredTo ? { lte: endOfDay(query.requiredTo) } : {}),
        },
      });
    }
    // GOURI leaves `getPurchaseRequisitions` completely unguarded; here view_own really narrows.
    if (!(await this.ability.can(user, 'purchase_requisition.view_all'))) {
      and.push({ createdBy: user.sub });
    }

    const where: Prisma.TransactionWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { transactionDate: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          location: { select: { name: true } },
          purchaseLines: { select: { quantity: true, poQuantityPurchased: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    const names = await this.userNames(rows.map((r) => r.createdBy));
    return {
      data: rows.map((r) => {
        const ordered = r.purchaseLines.reduce((sum, l) => sum + Number(l.quantity), 0);
        const taken = r.purchaseLines.reduce((sum, l) => sum + Number(l.poQuantityPurchased), 0);
        return {
          id: r.id,
          refNo: r.refNo,
          transactionDate: r.transactionDate,
          deliveryDate: r.deliveryDate,
          location: r.location.name,
          status: r.status.toLowerCase(),
          items: r.purchaseLines.length,
          quantityOrdered: round4(ordered),
          quantityRemaining: round4(ordered - taken),
          addedBy: names.get(r.createdBy) ?? '',
        };
      }),
      total,
    };
  }

  async findOne(businessId: number, id: number) {
    const r = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'PURCHASE_REQUISITION' },
      include: {
        location: { select: { id: true, name: true } },
        purchaseLines: {
          orderBy: { id: 'asc' },
          include: {
            product: { select: { id: true, name: true, alertQuantity: true } },
            variation: { select: { id: true, name: true, subSku: true } },
          },
        },
      },
    });
    if (!r) throw new NotFoundException('Purchase requisition not found');

    const names = await this.userNames([r.createdBy]);
    return {
      id: r.id,
      refNo: r.refNo,
      transactionDate: r.transactionDate,
      deliveryDate: r.deliveryDate,
      status: r.status.toLowerCase(),
      locationId: r.locationId,
      location: r.location.name,
      additionalNotes: r.additionalNotes ?? '',
      addedBy: names.get(r.createdBy) ?? '',
      lines: r.purchaseLines.map((l) => ({
        id: l.id,
        productId: l.productId,
        variationId: l.variationId,
        product: l.product.name,
        variation: l.variation.name === 'DUMMY' ? '' : l.variation.name,
        sku: l.variation.subSku ?? '',
        alertQuantity: l.product.alertQuantity != null ? Number(l.product.alertQuantity) : null,
        quantity: Number(l.quantity),
        secondaryUnitQuantity: Number(l.secondaryUnitQuantity),
        quantityOrdered: Number(l.poQuantityPurchased),
        quantityRemaining: remainingOf(l),
      })),
    };
  }

  async remove(user: AccessPayload, id: number) {
    const businessId = user.businessId as number;
    const r = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: 'PURCHASE_REQUISITION' },
      include: { purchaseLines: { select: { poQuantityPurchased: true } } },
    });
    if (!r) throw new NotFoundException('Purchase requisition not found');

    // GOURI deletes regardless, nulls the link on the orders' lines and leaves their counters
    // pointing at a document that no longer exists.
    const taken = r.purchaseLines.reduce((sum, l) => sum + Number(l.poQuantityPurchased), 0);
    if (taken > 0) {
      throw new ConflictException(
        'Purchase orders have already been raised against this requisition — delete those first',
      );
    }

    await this.prisma.transaction.delete({ where: { id } });
    await this.audit.record({
      model: 'PurchaseRequisition',
      subjectId: id,
      name: r.refNo,
      action: 'deleted',
      after: { refNo: r.refNo },
    });
    return { success: true, msg: 'Purchase requisition deleted' };
  }

  /**
   * Products at or below their alert quantity — the picker GOURI's create screen opens with.
   * Its version groups by variation while selecting one location's stock row, so a product held
   * in several locations reports an arbitrary one; this sums the locations actually asked for.
   */
  async lowStock(
    businessId: number,
    opts: { locationId?: number; brandIds?: number[]; categoryIds?: number[] },
  ) {
    const variations = await this.prisma.variation.findMany({
      where: {
        deletedAt: null,
        product: {
          businessId,
          isInactive: false,
          enableStock: true,
          alertQuantity: { not: null },
          type: { not: 'combo' },
          ...(opts.brandIds?.length ? { brandId: { in: opts.brandIds } } : {}),
          ...(opts.categoryIds?.length ? { categoryId: { in: opts.categoryIds } } : {}),
        },
      },
      include: {
        productVariation: { select: { name: true } },
        product: {
          select: { id: true, name: true, type: true, alertQuantity: true, unitId: true },
        },
        stockLevels: {
          where: opts.locationId ? { locationId: opts.locationId } : {},
          select: { qtyAvailable: true },
        },
      },
      orderBy: { id: 'asc' },
      take: 500,
    });

    const unitIds = [...new Set(variations.map((v) => v.product.unitId).filter(Boolean) as number[])];
    const units = unitIds.length
      ? await this.prisma.unit.findMany({
          where: { id: { in: unitIds }, businessId },
          select: { id: true, shortName: true, allowDecimal: true },
        })
      : [];
    const unitById = new Map(units.map((u) => [u.id, u]));

    return {
      data: variations
        .map((v) => {
          const stock = round4(v.stockLevels.reduce((sum, sl) => sum + Number(sl.qtyAvailable), 0));
          const alert = Number(v.product.alertQuantity);
          const unit = v.product.unitId ? unitById.get(v.product.unitId) : undefined;
          return {
            variationId: v.id,
            productId: v.product.id,
            name: v.product.name,
            variation: v.product.type === 'variable' ? `${v.productVariation.name} - ${v.name}` : '',
            sku: v.subSku ?? '',
            currentStock: stock,
            alertQuantity: alert,
            /** What it would take to get back to the alert level — the obvious default. */
            suggestedQuantity: round4(Math.max(alert - stock, 0)),
            unitName: unit?.shortName ?? '',
            allowDecimal: unit?.allowDecimal ?? true,
          };
        })
        .filter((r) => r.currentStock <= r.alertQuantity),
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
