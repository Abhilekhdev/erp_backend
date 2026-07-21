import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { AbilityService } from '../../common/services/ability.service';
import { StorageService } from '../../common/services/storage.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../auth/token.service';
import type { SaveProductDto } from './dto/save-product.dto';
import type { ProductsQueryDto } from './dto/products-query.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);

const ALLOWED_IMAGE = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
/** GOURI allows 5 MB (config/constants.php) but silently DROPS anything larger — we reject instead. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
const num = (v?: number | null): number | null => (v == null ? null : v);
const HYPHEN_BARCODES = new Set(['C128', 'C39']);

type PriceLine = NonNullable<SaveProductDto['single']>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ability: AbilityService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Flat "what a user would call the product" state, for the activity trail.
   *
   * A product's prices are not on its own row — they live in child `variations`, which a save wipes
   * and rebuilds. So the generic Prisma audit hook cannot see a price edit at all; Product is marked
   * `manual` in AUDITED_MODELS and logged here instead, by comparing this snapshot before and after.
   * Flattening variation prices to `<variation> purchase/sell price` is what turns an entry into the
   * line a user actually wants: "Sell price 100 → 120".
   */
  private async auditSnapshot(id: number): Promise<Record<string, unknown>> {
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: { variations: { where: { deletedAt: null }, orderBy: { id: 'asc' } } },
    });
    if (!p) return {};
    const { variations, ...scalars } = p;
    const flat: Record<string, unknown> = { ...scalars };
    for (const v of variations) {
      // A single product has one "DUMMY" variation — its prices ARE the product's prices.
      const prefix = v.name === 'DUMMY' ? '' : `${v.name} `;
      flat[`${prefix}purchasePrice`] = v.defaultPurchasePrice?.toString() ?? null;
      flat[`${prefix}sellPrice`] = v.defaultSellPrice?.toString() ?? null;
      flat[`${prefix}sellPriceIncTax`] = v.sellPriceIncTax?.toString() ?? null;
    }
    return flat;
  }

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
    // Locations and racks both name business_locations — a crafted payload must not reach across tenants.
    const locationIds = [
      ...new Set([...(dto.product_locations ?? []), ...Object.keys(dto.product_racks ?? {}).map(Number)]),
    ].filter((id) => Number.isInteger(id) && id > 0);
    if (locationIds.length) {
      const n = await this.prisma.businessLocation.count({
        where: { id: { in: locationIds }, businessId, deletedAt: null },
      });
      if (n !== locationIds.length) throw new BadRequestException('One or more business locations are invalid');
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
      preparationTimeInMinutes: dto.preparation_time_in_minutes ?? null,
      image: blank(dto.image),
      createdAt: new Date(),
    };
  }

  /**
   * Replace-set the location assignments and rack details.
   *
   * GOURI syncs locations but *blind-inserts* racks (`ProductUtil::addRackDetails`), so editing a
   * product that already had racks can leave duplicate rows for the same location. Deleting first
   * (plus the unique key on product+location) makes a save idempotent however many times it runs.
   */
  private async writeLocationsAndRacks(
    tx: Prisma.TransactionClient,
    businessId: number,
    productId: number,
    dto: SaveProductDto,
  ): Promise<void> {
    if (dto.product_locations) {
      await tx.productLocation.deleteMany({ where: { productId } });
      const ids = [...new Set(dto.product_locations)];
      if (ids.length) {
        await tx.productLocation.createMany({
          data: ids.map((locationId) => ({ productId, locationId })),
        });
      }
    }

    if (dto.product_racks) {
      await tx.productRack.deleteMany({ where: { productId } });
      const rows = Object.entries(dto.product_racks)
        .map(([locationId, r]) => ({
          businessId,
          productId,
          locationId: Number(locationId),
          rack: blank(r.rack),
          row: blank(r.row),
          position: blank(r.position),
        }))
        // A location the user left entirely blank is not a rack assignment.
        .filter((r) => Number.isInteger(r.locationId) && (r.rack || r.row || r.position));
      if (rows.length) await tx.productRack.createMany({ data: rows });
    }
  }

  /**
   * POST /products/image — store the file and hand back its path for the product payload.
   *
   * Uploaded separately from the product itself so the JSON save stays a plain JSON call: the form
   * uploads on file-select, then submits the returned path as `image`. Unlike the contacts import,
   * this file IS a record, not transport, so it is persisted via StorageService — S3 when
   * AWS_BUCKET is set, local disk otherwise. The returned `path` is identical either way.
   */
  async uploadImage(businessId: number, file?: UploadedImage) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_IMAGE.includes(file.mimetype)) {
      throw new BadRequestException('Product image must be a PNG, JPG, GIF or WEBP image');
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException(`Image must be under ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
    }
    // Business-prefixed + random: no collisions, and an upload can never overwrite another tenant's file.
    return this.storage.put('products', file, businessId);
  }

  // ── media (brochure + variation images) ───────────────

  /** GOURI's allowed brochure mimes (config/constants.php `document_mimes`). */
  private static readonly BROCHURE_MIMES = [
    'application/pdf',
    'text/csv',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg',
    'image/jpg',
  ];

  /**
   * Attach a file to a product — the brochure, or an extra photo for a variation.
   *
   * `products.image` stays the single primary image; anything else lives in `media`, keyed by
   * (modelType, modelId, modelMediaType) exactly like GOURI's morph table.
   */
  async uploadMedia(
    businessId: number,
    userId: number,
    productId: number,
    kind: 'product_brochure' | 'variation_image',
    file?: UploadedImage,
  ) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, businessId } });
    if (!product) throw new NotFoundException('Product not found');
    if (!file) throw new BadRequestException('No file uploaded');

    const allowed = kind === 'product_brochure' ? ProductsService.BROCHURE_MIMES : ALLOWED_IMAGE;
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        kind === 'product_brochure'
          ? 'Brochure must be a PDF, Word document, image, CSV or ZIP'
          : 'Variation image must be a PNG, JPG, GIF or WEBP image',
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException(`File must be under ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
    }

    const stored = await this.storage.put(kind === 'product_brochure' ? 'brochures' : 'products', file, businessId);
    // One brochure per product (GOURI passes `is_single = true`) — replace the old one.
    if (kind === 'product_brochure') {
      await this.deleteMediaWhere({ businessId, modelType: 'Product', modelId: productId, modelMediaType: kind });
    }
    const row = await this.prisma.media.create({
      data: {
        businessId,
        modelType: 'Product',
        modelId: productId,
        modelMediaType: kind,
        filePath: stored.path,
        fileName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        uploadedBy: userId,
      },
    });
    return { id: row.id, path: stored.path, url: stored.url, fileName: row.fileName, kind };
  }

  /** Remove the rows AND the stored objects, so deleting never leaves an orphan file behind. */
  private async deleteMediaWhere(where: Prisma.MediaWhereInput): Promise<number> {
    const rows = await this.prisma.media.findMany({ where, select: { id: true, filePath: true } });
    if (!rows.length) return 0;
    await this.prisma.media.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    // Best-effort: a missing object must not fail the request the user actually asked for.
    await Promise.all(rows.map((r) => this.storage.remove(r.filePath).catch(() => undefined)));
    return rows.length;
  }

  async listMedia(businessId: number, productId: number) {
    const rows = await this.prisma.media.findMany({
      where: { businessId, modelType: 'Product', modelId: productId },
      orderBy: { id: 'asc' },
    });
    const data = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        kind: r.modelMediaType,
        path: r.filePath,
        url: await this.storage.url(r.filePath),
        fileName: r.fileName,
        mimeType: r.mimeType,
        fileSize: r.fileSize,
      })),
    );
    return { data };
  }

  async removeMedia(businessId: number, mediaId: number) {
    const removed = await this.deleteMediaWhere({ id: mediaId, businessId });
    if (!removed) throw new NotFoundException('File not found');
    return { success: true, msg: 'File deleted successfully' };
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
        await this.writeLocationsAndRacks(tx, businessId, product.id, dto);
        return product.id;
      },
      { timeout: 30000 },
    );
    // Overlap the audit snapshot with the response read — on a serverless DB a sequential extra
    // round-trip is the whole cost, so never spend one the request has to wait on.
    const [after, out] = await Promise.all([this.auditSnapshot(productId), this.findOne(businessId, productId)]);
    this.audit.record({ model: 'Product', subjectId: productId, action: 'created', after, name: dto.name, businessId });
    return out;
  }

  async update(businessId: number, id: number, dto: SaveProductDto) {
    const existing = await this.prisma.product.findFirst({ where: { id, businessId } });
    if (!existing) throw new NotFoundException('Product not found');
    // Kicked off here, awaited after validation — it rides along with queries we already make.
    const beforeSnapshot = this.auditSnapshot(id);
    await this.assertRefs(businessId, dto);
    const wantedSku = dto.sku?.trim();
    if (wantedSku && wantedSku !== existing.sku) {
      const dup = await this.prisma.product.findFirst({ where: { businessId, sku: wantedSku, id: { not: id } } });
      if (dup) throw new BadRequestException('That SKU is already in use');
    }
    const before = await beforeSnapshot;
    await this.prisma.$transaction(
      async (tx) => {
        const sku = wantedSku || existing.sku;
        await tx.product.update({ where: { id }, data: { ...this.scalarData(businessId, existing.createdBy, dto), sku } });
        // Simplification (safe until stock/transactions exist): rebuild the variation structure from
        // scratch. Once purchases/stock reference variation ids, switch to an id-preserving sync.
        await tx.productVariation.deleteMany({ where: { productId: id } }); // cascades variations + group prices
        await this.buildVariations(tx, id, sku, dto);
        await this.writeLocationsAndRacks(tx, businessId, id, dto);
      },
      { timeout: 30000 },
    );
    const [after, out] = await Promise.all([this.auditSnapshot(id), this.findOne(businessId, id)]);
    this.audit.record({ model: 'Product', subjectId: id, action: 'updated', before, after, name: dto.name, businessId });
    return out;
  }

  async setActive(businessId: number, id: number, active: boolean) {
    const p = await this.prisma.product.findFirst({ where: { id, businessId } });
    if (!p) throw new NotFoundException('Product not found');
    await this.prisma.product.update({ where: { id }, data: { isInactive: !active } });
    this.audit.record({
      model: 'Product',
      subjectId: id,
      action: 'updated',
      before: { isInactive: p.isInactive },
      after: { isInactive: !active },
      name: p.name,
      businessId,
    });
    return this.findOne(businessId, id);
  }

  async remove(businessId: number, id: number) {
    const p = await this.prisma.product.findFirst({ where: { id, businessId } });
    if (!p) throw new NotFoundException('Product not found');
    // NOTE: GOURI blocks deletion when the product is used in any transaction — add that guard once
    // the transaction core exists. Hard delete cascades variations / product_variations / group prices.
    const before = await this.auditSnapshot(id);
    await this.prisma.product.delete({ where: { id } });
    this.audit.record({ model: 'Product', subjectId: id, action: 'deleted', before, name: p.name, businessId });
    return { success: true, msg: 'Product deleted successfully' };
  }

  // ── list ──────────────────────────────────────────────
  async list(user: AccessPayload, query: ProductsQueryDto) {
    const businessId = user.businessId as number;
    const s = query.search.trim();
    const where: Prisma.ProductWhereInput = {
      businessId,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.unitId ? { unitId: query.unitId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.taxId ? { taxRateId: query.taxId } : {}),
      ...(query.active !== undefined ? { isInactive: !query.active } : {}),
      ...(query.notForSelling !== undefined ? { notForSelling: query.notForSelling } : {}),
      // 'none' finds products that were never assigned to a location — GOURI's "None" filter option.
      ...(query.locationId === 'none'
        ? { locations: { none: {} } }
        : query.locationId
          ? { locations: { some: { locationId: query.locationId } } }
          : {}),
      ...(s
        ? {
            OR: [
              { name: { contains: s, mode: 'insensitive' } },
              { sku: { contains: s, mode: 'insensitive' } },
              // GOURI's SKU column also searches variation sub-SKUs (ProductController.php:291-296).
              { variations: { some: { deletedAt: null, subSku: { contains: s, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [rows, total, units, cats, brands, taxes] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { name: 'asc' },
        include: {
          variations: { where: { deletedAt: null }, select: { sellPriceIncTax: true, defaultPurchasePrice: true } },
          locations: { select: { location: { select: { id: true, name: true } } } },
        },
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

    // GOURI hides these two columns behind their own permissions (product/index.blade.php) — a
    // salesperson can be allowed to see products without seeing what the business paid for them.
    // Both were seeded in our catalogue but never enforced, so the grants did nothing. Resolve them
    // once per request via AbilityService (in-memory; the guard already loaded the set).
    const [canSeePurchase, canSeeSelling] = await Promise.all([
      this.ability.can(user, 'view_purchase_price'),
      this.ability.can(user, 'access_default_selling_price'),
    ]);

    const range = (values: number[]) => ({
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 0,
    });

    return {
      data: rows.map((p) => {
        const sell = range(p.variations.map((v) => (v.sellPriceIncTax == null ? 0 : Number(v.sellPriceIncTax))));
        const purchase = range(
          p.variations.map((v) => (v.defaultPurchasePrice == null ? 0 : Number(v.defaultPurchasePrice))),
        );
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
          locations: p.locations.map((l) => l.location.name),
          customField1: p.productCustomField1 ?? '',
          customField2: p.productCustomField2 ?? '',
          customField3: p.productCustomField3 ?? '',
          customField4: p.productCustomField4 ?? '',
          // null (not 0) when not permitted, so the UI drops the column instead of showing a
          // convincing-looking zero.
          priceMin: canSeeSelling ? sell.min : null,
          priceMax: canSeeSelling ? sell.max : null,
          purchasePriceMin: canSeePurchase ? purchase.min : null,
          purchasePriceMax: canSeePurchase ? purchase.max : null,
        };
      }),
      total,
      can: { viewPurchasePrice: canSeePurchase, viewSellingPrice: canSeeSelling },
    };
  }

  /**
   * Download Excel — the current filter set, every matching row, no pagination.
   *
   * GOURI gates this on `is_admin` rather than a permission (`ProductController@downloadExcel`), so
   * a manager who can see the list cannot export it. We reuse the list's own permission and, more
   * importantly, its price gating: an export must not become a way around `view_purchase_price`.
   */
  async exportExcel(user: AccessPayload, query: ProductsQueryDto): Promise<Buffer> {
    const all = await this.list(user, { ...query, page: 1, pageSize: 10_000 });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Products');
    const columns = [
      { header: 'SKU', key: 'sku', width: 18 },
      { header: 'Product', key: 'name', width: 32 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Category', key: 'category', width: 20 },
      { header: 'Brand', key: 'brand', width: 18 },
      { header: 'Unit', key: 'unit', width: 14 },
      { header: 'Tax', key: 'tax', width: 16 },
      { header: 'Business locations', key: 'locations', width: 32 },
      ...(all.can.viewPurchasePrice ? [{ header: 'Purchase price', key: 'purchase', width: 16 }] : []),
      ...(all.can.viewSellingPrice ? [{ header: 'Selling price (inc tax)', key: 'sell', width: 20 }] : []),
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Not for selling', key: 'notForSelling', width: 14 },
      { header: 'Custom field 1', key: 'customField1', width: 18 },
      { header: 'Custom field 2', key: 'customField2', width: 18 },
      { header: 'Custom field 3', key: 'customField3', width: 18 },
      { header: 'Custom field 4', key: 'customField4', width: 18 },
    ];
    ws.columns = columns;
    ws.getRow(1).font = { bold: true };

    const priceCell = (min: number | null, max: number | null) =>
      min == null || max == null ? '' : min === max ? min : `${min} - ${max}`;

    for (const p of all.data) {
      ws.addRow({
        sku: p.sku,
        name: p.name,
        type: p.type ?? '',
        category: p.category,
        brand: p.brand,
        unit: p.unit,
        tax: p.tax,
        locations: p.locations.join(', '),
        purchase: priceCell(p.purchasePriceMin, p.purchasePriceMax),
        sell: priceCell(p.priceMin, p.priceMax),
        status: p.isInactive ? 'Inactive' : 'Active',
        notForSelling: p.notForSelling ? 'Yes' : 'No',
        customField1: p.customField1,
        customField2: p.customField2,
        customField3: p.customField3,
        customField4: p.customField4,
      });
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── mass actions (GOURI's list footer) ────────────────

  /** Every id that exists in this tenant — silently ignores anything that doesn't. */
  private async ownedIds(businessId: number, ids: number[]): Promise<number[]> {
    if (!ids.length) throw new BadRequestException('Select at least one product');
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids }, businessId },
      select: { id: true, name: true },
    });
    if (!rows.length) throw new BadRequestException('None of those products exist');
    return rows.map((r) => r.id);
  }

  async massDelete(businessId: number, ids: number[]) {
    const owned = await this.ownedIds(businessId, ids);
    // NOTE: like remove(), this needs GOURI's "used in a transaction" guard once transactions exist.
    const { count } = await this.prisma.product.deleteMany({ where: { id: { in: owned }, businessId } });
    this.audit.log({
      action: 'bulk_deleted',
      subjectType: 'Product',
      businessId,
      description: `${count} product${count === 1 ? '' : 's'} deleted`,
      properties: { count, ids: owned },
    });
    return { success: true, count, msg: `${count} product(s) deleted` };
  }

  async massSetActive(businessId: number, ids: number[], active: boolean) {
    const owned = await this.ownedIds(businessId, ids);
    const { count } = await this.prisma.product.updateMany({
      where: { id: { in: owned }, businessId },
      data: { isInactive: !active },
    });
    this.audit.log({
      action: 'bulk_updated',
      subjectType: 'Product',
      businessId,
      description: `${count} product${count === 1 ? '' : 's'} ${active ? 'activated' : 'deactivated'}`,
      properties: { count, ids: owned, isInactive: !active },
    });
    return { success: true, count, msg: `${count} product(s) ${active ? 'activated' : 'deactivated'}` };
  }

  /**
   * Add or remove a set of products from a set of locations in one go (GOURI's
   * `updateProductLocation`). "Add" is idempotent — re-adding an existing pair is a no-op rather
   * than a duplicate row.
   */
  async massUpdateLocations(businessId: number, ids: number[], locationIds: number[], mode: 'add' | 'remove') {
    const owned = await this.ownedIds(businessId, ids);
    if (!locationIds.length) throw new BadRequestException('Select at least one location');
    const validLocations = await this.prisma.businessLocation.count({
      where: { id: { in: locationIds }, businessId, deletedAt: null },
    });
    if (validLocations !== new Set(locationIds).size) {
      throw new BadRequestException('One or more business locations are invalid');
    }

    if (mode === 'remove') {
      const { count } = await this.prisma.productLocation.deleteMany({
        where: { productId: { in: owned }, locationId: { in: locationIds } },
      });
      this.audit.log({
        action: 'bulk_updated',
        subjectType: 'Product',
        businessId,
        description: `${owned.length} product(s) removed from ${locationIds.length} location(s)`,
        properties: { products: owned, locations: locationIds, mode },
      });
      return { success: true, count, msg: 'Products removed from the selected locations' };
    }

    const pairs = owned.flatMap((productId) => locationIds.map((locationId) => ({ productId, locationId })));
    const { count } = await this.prisma.productLocation.createMany({ data: pairs, skipDuplicates: true });
    this.audit.log({
      action: 'bulk_updated',
      subjectType: 'Product',
      businessId,
      description: `${owned.length} product(s) added to ${locationIds.length} location(s)`,
      properties: { products: owned, locations: locationIds, mode },
    });
    return { success: true, count, msg: 'Products added to the selected locations' };
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
        locations: { select: { locationId: true } },
        racks: { orderBy: { locationId: 'asc' } },
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
      preparationTimeInMinutes: p.preparationTimeInMinutes,
      image: p.image ?? '',
      productLocations: p.locations.map((l) => l.locationId),
      // Keyed by location id so the form can look a location's row up directly.
      productRacks: Object.fromEntries(
        p.racks.map((r) => [r.locationId, { rack: r.rack ?? '', row: r.row ?? '', position: r.position ?? '' }]),
      ),
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
    const [units, categories, brands, taxRates, warranties, priceGroups, templates, locations, settings] =
      await Promise.all([
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
      this.prisma.businessLocation.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      // GOURI hides whole sections of the product form behind business settings — the form must be
      // driven by these, not render everything unconditionally.
      this.prisma.business.findUnique({
        where: { id: businessId },
        select: {
          enableBrand: true,
          enableCategory: true,
          enableSubCategory: true,
          enablePriceTax: true,
          enableSubUnits: true,
          enableRacks: true,
          enableRow: true,
          enablePosition: true,
          enableProductExpiry: true,
          defaultProfitPercent: true,
          defaultUnit: true,
        },
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
      locations,
      settings: {
        enableBrand: settings?.enableBrand ?? true,
        enableCategory: settings?.enableCategory ?? true,
        enableSubCategory: settings?.enableSubCategory ?? true,
        enablePriceTax: settings?.enablePriceTax ?? true,
        enableSubUnits: settings?.enableSubUnits ?? false,
        enableRacks: settings?.enableRacks ?? false,
        enableRow: settings?.enableRow ?? false,
        enablePosition: settings?.enablePosition ?? false,
        enableProductExpiry: settings?.enableProductExpiry ?? false,
        defaultProfitPercent: settings?.defaultProfitPercent != null ? Number(settings.defaultProfitPercent) : 0,
        defaultUnitId: settings?.defaultUnit ?? null,
      },
    };
  }
}
