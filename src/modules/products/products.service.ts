import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { SaveProductDto } from './dto/save-product.dto';
import type { ProductsQueryDto } from './dto/products-query.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);
const num = (v?: number | null): number | null => (v == null ? null : v);
const HYPHEN_BARCODES = new Set(['C128', 'C39']);

type PriceLine = NonNullable<SaveProductDto['single']>;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── reference validation (GOURI has no DB FKs — validate same-tenant here) ──
  private async assertRefs(businessId: number, dto: SaveProductDto) {
    const check = async (id: number | undefined, where: Prisma.UnitWhereInput | object, table: string, label: string) => {
      if (!id) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const found = await (this.prisma as any)[table].findFirst({ where: { id, businessId, ...where } });
      if (!found) throw new BadRequestException(`Selected ${label} is invalid`);
    };
    await check(dto.unit_id, { deletedAt: null }, 'unit', 'unit');
    await check(dto.secondary_unit_id, { deletedAt: null }, 'unit', 'secondary unit');
    await check(dto.brand_id, { deletedAt: null }, 'brand', 'brand');
    await check(dto.category_id, { deletedAt: null, categoryType: 'product' }, 'category', 'category');
    await check(dto.sub_category_id, { deletedAt: null, categoryType: 'product' }, 'category', 'sub-category');
    await check(dto.tax, { deletedAt: null }, 'taxRate', 'tax rate');
    await check(dto.warranty_id, {}, 'warranty', 'warranty');
    if (dto.sub_unit_ids?.length) {
      const n = await this.prisma.unit.count({ where: { id: { in: dto.sub_unit_ids }, businessId, deletedAt: null } });
      if (n !== new Set(dto.sub_unit_ids).size) throw new BadRequestException('One or more sub-units are invalid');
    }
    if (dto.type === 'combo' && dto.combo) {
      const ids = dto.combo.composition.map((c) => c.variation_id);
      const n = await this.prisma.variation.count({
        where: { id: { in: ids }, deletedAt: null, product: { businessId } },
      });
      if (n !== new Set(ids).size) throw new BadRequestException('One or more combo items are invalid');
    }
  }

  private scalarData(businessId: number, createdBy: number, dto: SaveProductDto): Prisma.ProductUncheckedCreateInput {
    return {
      businessId,
      createdBy,
      name: dto.name,
      type: dto.type,
      unitId: dto.unit_id ?? null,
      secondaryUnitId: dto.secondary_unit_id ?? null,
      subUnitIds: dto.sub_unit_ids?.length ? dto.sub_unit_ids : Prisma.JsonNull,
      brandId: dto.brand_id ?? null,
      categoryId: dto.category_id ?? null,
      subCategoryId: dto.sub_category_id ?? null,
      taxRateId: dto.tax ?? null,
      taxType: dto.tax_type,
      enableStock: dto.enable_stock,
      alertQuantity: dto.alert_quantity ?? null,
      sku: '', // set after we know the id (or from dto)
      barcodeType: dto.barcode_type,
      expiryPeriod: dto.expiry_period ?? null,
      expiryPeriodType: blank(dto.expiry_period_type),
      enableSrNo: dto.enable_sr_no,
      weight: blank(dto.weight),
      productCustomField1: blank(dto.product_custom_field1),
      productCustomField2: blank(dto.product_custom_field2),
      productCustomField3: blank(dto.product_custom_field3),
      productCustomField4: blank(dto.product_custom_field4),
      productDescription: blank(dto.product_description),
      warrantyId: dto.warranty_id ?? null,
      notForSelling: dto.not_for_selling,
      createdAt: new Date(),
    };
  }

  private skuOf(prefix: string | null, id: number): string {
    return `${prefix ?? ''}${String(id).padStart(4, '0')}`;
  }
  private subSkuOf(sku: string, n: number, barcodeType: string): string {
    return HYPHEN_BARCODES.has(barcodeType) ? `${sku}-${n}` : `${sku}${n}`;
  }

  private async writeVariation(
    tx: Prisma.TransactionClient,
    productId: number,
    productVariationId: number,
    args: { name: string; subSku: string; variationValueId: number | null; line: PriceLine; combo?: unknown },
  ) {
    const { line } = args;
    const v = await tx.variation.create({
      data: {
        name: args.name,
        productId,
        productVariationId,
        subSku: args.subSku,
        variationValueId: args.variationValueId,
        defaultPurchasePrice: num(line.default_purchase_price),
        dppIncTax: line.dpp_inc_tax ?? 0,
        profitPercent: line.profit_percent ?? 0,
        defaultSellPrice: num(line.default_sell_price),
        sellPriceIncTax: num(line.sell_price_inc_tax),
        comboVariations: args.combo ? (args.combo as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
    if (line.group_prices?.length) {
      await tx.variationGroupPrice.createMany({
        data: line.group_prices.map((g) => ({ variationId: v.id, priceGroupId: g.price_group_id, priceIncTax: g.price_inc_tax })),
      });
    }
    return v;
  }

  /** Build product_variations + variations for the product's type (single / variable / combo). */
  private async buildVariations(tx: Prisma.TransactionClient, productId: number, sku: string, dto: SaveProductDto) {
    if (dto.type === 'single') {
      const pv = await tx.productVariation.create({ data: { productId, name: 'DUMMY', isDummy: true } });
      await this.writeVariation(tx, productId, pv.id, {
        name: 'DUMMY',
        subSku: sku,
        variationValueId: null,
        line: dto.single as PriceLine,
      });
    } else if (dto.type === 'variable') {
      let counter = 0;
      for (const attr of dto.variations ?? []) {
        const pv = await tx.productVariation.create({
          data: { productId, name: attr.name, isDummy: false, variationTemplateId: attr.variation_template_id ?? null },
        });
        for (const val of attr.values) {
          counter += 1;
          const subSku = val.sub_sku?.trim() || this.subSkuOf(sku, counter, dto.barcode_type);
          await this.writeVariation(tx, productId, pv.id, {
            name: val.value,
            subSku,
            variationValueId: val.variation_value_id ?? null,
            line: val,
          });
        }
      }
    } else {
      const pv = await tx.productVariation.create({ data: { productId, name: 'DUMMY', isDummy: true } });
      const combo = dto.combo as NonNullable<SaveProductDto['combo']>;
      const composition = combo.composition.map((c) => ({ variation_id: c.variation_id, quantity: c.quantity, unit_id: c.unit_id ?? null }));
      await this.writeVariation(tx, productId, pv.id, {
        name: 'DUMMY',
        subSku: sku,
        variationValueId: null,
        line: combo,
        combo: composition,
      });
    }
  }

  async create(businessId: number, createdBy: number, dto: SaveProductDto) {
    await this.assertRefs(businessId, dto);
    const wantedSku = dto.sku?.trim();
    if (wantedSku) {
      const dup = await this.prisma.product.findFirst({ where: { businessId, sku: wantedSku } });
      if (dup) throw new BadRequestException('That SKU is already in use');
    }
    const biz = await this.prisma.business.findUnique({ where: { id: businessId }, select: { skuPrefix: true } });

    const productId = await this.prisma.$transaction(
      async (tx) => {
        const product = await tx.product.create({ data: { ...this.scalarData(businessId, createdBy, dto), sku: wantedSku ?? '' } });
        const sku = wantedSku || this.skuOf(biz?.skuPrefix ?? '', product.id);
        if (!wantedSku) await tx.product.update({ where: { id: product.id }, data: { sku } });
        await this.buildVariations(tx, product.id, sku, dto);
        return product.id;
      },
      { timeout: 30000 },
    );
    return this.findOne(businessId, productId);
  }

  async update(businessId: number, id: number, dto: SaveProductDto) {
    const existing = await this.prisma.product.findFirst({ where: { id, businessId } });
    if (!existing) throw new NotFoundException('Product not found');
    await this.assertRefs(businessId, dto);
    const wantedSku = dto.sku?.trim();
    if (wantedSku && wantedSku !== existing.sku) {
      const dup = await this.prisma.product.findFirst({ where: { businessId, sku: wantedSku, id: { not: id } } });
      if (dup) throw new BadRequestException('That SKU is already in use');
    }
    await this.prisma.$transaction(
      async (tx) => {
        const sku = wantedSku || existing.sku;
        await tx.product.update({ where: { id }, data: { ...this.scalarData(businessId, existing.createdBy, dto), sku } });
        // Simplification (safe until stock/transactions exist): rebuild the variation structure from
        // scratch. Once purchases/stock reference variation ids, switch to an id-preserving sync.
        await tx.productVariation.deleteMany({ where: { productId: id } }); // cascades variations + group prices
        await this.buildVariations(tx, id, sku, dto);
      },
      { timeout: 30000 },
    );
    return this.findOne(businessId, id);
  }

  async setActive(businessId: number, id: number, active: boolean) {
    const p = await this.prisma.product.findFirst({ where: { id, businessId } });
    if (!p) throw new NotFoundException('Product not found');
    await this.prisma.product.update({ where: { id }, data: { isInactive: !active } });
    return this.findOne(businessId, id);
  }

  async remove(businessId: number, id: number) {
    const p = await this.prisma.product.findFirst({ where: { id, businessId } });
    if (!p) throw new NotFoundException('Product not found');
    // NOTE: GOURI blocks deletion when the product is used in any transaction — add that guard once
    // the transaction core exists. Hard delete cascades variations / product_variations / group prices.
    await this.prisma.product.delete({ where: { id } });
    return { success: true, msg: 'Product deleted successfully' };
  }

  // ── list ──────────────────────────────────────────────
  async list(businessId: number, query: ProductsQueryDto) {
    const s = query.search.trim();
    const where: Prisma.ProductWhereInput = {
      businessId,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.unitId ? { unitId: query.unitId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.active !== undefined ? { isInactive: !query.active } : {}),
      ...(s ? { OR: [{ name: { contains: s, mode: 'insensitive' } }, { sku: { contains: s, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total, units, cats, brands, taxes] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { name: 'asc' },
        include: { variations: { where: { deletedAt: null }, select: { sellPriceIncTax: true } } },
      }),
      this.prisma.product.count({ where }),
      this.prisma.unit.findMany({ where: { businessId }, select: { id: true, actualName: true } }),
      this.prisma.category.findMany({ where: { businessId }, select: { id: true, name: true } }),
      this.prisma.brand.findMany({ where: { businessId }, select: { id: true, name: true } }),
      this.prisma.taxRate.findMany({ where: { businessId }, select: { id: true, name: true, amount: true } }),
    ]);
    const uMap = new Map(units.map((u) => [u.id, u.actualName]));
    const cMap = new Map(cats.map((c) => [c.id, c.name]));
    const bMap = new Map(brands.map((b) => [b.id, b.name]));
    const tMap = new Map(taxes.map((t) => [t.id, t]));
    return {
      data: rows.map((p) => {
        const prices = p.variations.map((v) => (v.sellPriceIncTax == null ? 0 : Number(v.sellPriceIncTax)));
        const min = prices.length ? Math.min(...prices) : 0;
        const max = prices.length ? Math.max(...prices) : 0;
        return {
          id: p.id,
          name: p.name,
          sku: p.sku,
          type: p.type,
          image: p.image,
          unit: p.unitId ? uMap.get(p.unitId) ?? '' : '',
          category: p.categoryId ? cMap.get(p.categoryId) ?? '' : '',
          brand: p.brandId ? bMap.get(p.brandId) ?? '' : '',
          tax: p.taxRateId ? tMap.get(p.taxRateId)?.name ?? '' : '',
          taxAmount: p.taxRateId ? Number(tMap.get(p.taxRateId)?.amount ?? 0) : 0,
          taxType: p.taxType,
          enableStock: p.enableStock,
          isInactive: p.isInactive,
          notForSelling: p.notForSelling,
          priceMin: min,
          priceMax: max,
        };
      }),
      total,
    };
  }

  // ── findOne (edit form) ───────────────────────────────
  async findOne(businessId: number, id: number) {
    const p = await this.prisma.product.findFirst({
      where: { id, businessId },
      include: {
        productVariations: {
          orderBy: { id: 'asc' },
          include: {
            variations: {
              where: { deletedAt: null },
              orderBy: { id: 'asc' },
              include: { groupPrices: true },
            },
          },
        },
      },
    });
    if (!p) throw new NotFoundException('Product not found');
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      unitId: p.unitId,
      secondaryUnitId: p.secondaryUnitId,
      subUnitIds: Array.isArray(p.subUnitIds) ? (p.subUnitIds as number[]) : [],
      brandId: p.brandId,
      categoryId: p.categoryId,
      subCategoryId: p.subCategoryId,
      tax: p.taxRateId,
      taxType: p.taxType,
      enableStock: p.enableStock,
      alertQuantity: p.alertQuantity != null ? Number(p.alertQuantity) : null,
      sku: p.sku,
      barcodeType: p.barcodeType,
      expiryPeriod: p.expiryPeriod != null ? Number(p.expiryPeriod) : null,
      expiryPeriodType: p.expiryPeriodType,
      enableSrNo: p.enableSrNo,
      weight: p.weight ?? '',
      productCustomField1: p.productCustomField1 ?? '',
      productCustomField2: p.productCustomField2 ?? '',
      productCustomField3: p.productCustomField3 ?? '',
      productCustomField4: p.productCustomField4 ?? '',
      productDescription: p.productDescription ?? '',
      warrantyId: p.warrantyId,
      isInactive: p.isInactive,
      notForSelling: p.notForSelling,
      productVariations: p.productVariations.map((pv) => ({
        id: pv.id,
        name: pv.name,
        isDummy: pv.isDummy,
        variationTemplateId: pv.variationTemplateId,
        variations: pv.variations.map((v) => ({
          id: v.id,
          name: v.name,
          subSku: v.subSku ?? '',
          variationValueId: v.variationValueId,
          defaultPurchasePrice: v.defaultPurchasePrice != null ? Number(v.defaultPurchasePrice) : null,
          dppIncTax: Number(v.dppIncTax),
          profitPercent: Number(v.profitPercent),
          defaultSellPrice: v.defaultSellPrice != null ? Number(v.defaultSellPrice) : null,
          sellPriceIncTax: v.sellPriceIncTax != null ? Number(v.sellPriceIncTax) : null,
          comboVariations: v.comboVariations ?? null,
          groupPrices: v.groupPrices.map((g) => ({ priceGroupId: g.priceGroupId, priceIncTax: Number(g.priceIncTax) })),
        })),
      })),
    };
  }

  /**
   * Sellable variations (non-combo, active products). Used by the combo component picker AND the
   * Print Labels picker — hence it also returns the barcode value (subSku), display name, tax-inc
   * sell price and barcode type.
   */
  async variationsForCombo(businessId: number, search: string) {
    const s = search.trim();
    const rows = await this.prisma.variation.findMany({
      where: {
        deletedAt: null,
        product: { businessId, type: { not: 'combo' }, isInactive: false },
        ...(s
          ? { OR: [{ subSku: { contains: s, mode: 'insensitive' } }, { product: { name: { contains: s, mode: 'insensitive' } } }] }
          : {}),
      },
      include: { product: { select: { name: true, unitId: true, barcodeType: true } } },
      orderBy: { id: 'asc' },
      take: 50,
    });
    return {
      data: rows.map((v) => ({
        id: v.id,
        label: `${v.product.name}${v.name === 'DUMMY' ? '' : ` - ${v.name}`}${v.subSku ? ` (${v.subSku})` : ''}`,
        productName: v.product.name,
        variationName: v.name === 'DUMMY' ? '' : v.name,
        sku: v.subSku ?? '',
        barcodeType: v.product.barcodeType,
        purchasePrice: v.defaultPurchasePrice != null ? Number(v.defaultPurchasePrice) : 0,
        sellPrice: v.defaultSellPrice != null ? Number(v.defaultSellPrice) : 0,
        sellPriceIncTax: v.sellPriceIncTax != null ? Number(v.sellPriceIncTax) : 0,
        unitId: v.product.unitId,
      })),
    };
  }

  // ── meta (form dropdowns) ─────────────────────────────
  async meta(businessId: number) {
    const [units, categories, brands, taxRates, warranties, priceGroups, templates] = await Promise.all([
      this.prisma.unit.findMany({ where: { businessId, deletedAt: null }, orderBy: { actualName: 'asc' } }),
      this.prisma.category.findMany({ where: { businessId, deletedAt: null, categoryType: 'product' }, orderBy: { name: 'asc' } }),
      this.prisma.brand.findMany({ where: { businessId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.taxRate.findMany({ where: { businessId, deletedAt: null, forTaxGroup: false }, select: { id: true, name: true, amount: true }, orderBy: { name: 'asc' } }),
      this.prisma.warranty.findMany({ where: { businessId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.sellingPriceGroup.findMany({ where: { businessId, deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.variationTemplate.findMany({
        where: { businessId },
        include: { values: { select: { name: true }, orderBy: { id: 'asc' } } },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      units: units.map((u) => ({ id: u.id, name: `${u.actualName} (${u.shortName})`, baseUnitId: u.baseUnitId })),
      categories: categories.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId })),
      brands,
      taxRates: taxRates.map((t) => ({ id: t.id, name: t.name, amount: Number(t.amount) })),
      warranties,
      priceGroups,
      variationTemplates: templates.map((t) => ({ id: t.id, name: t.name, values: t.values.map((v) => v.name) })),
      barcodeTypes: ['C128', 'C39', 'EAN13', 'EAN8', 'UPCA', 'UPCE'],
    };
  }
}
