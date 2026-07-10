import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../auth/token.service';
import { buildPaymentTypes, locationCustomFieldLabels } from './business-locations.constants';
import type { SaveBusinessLocationDto } from './dto/save-business-location.dto';

const ACCESS_ALL = 'access_all_locations';
const REF_TYPE = 'business_location';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);

@Injectable()
export class BusinessLocationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Locations the caller may see — mirrors GOURI `auth()->user()->permitted_locations()`.
   * Returns 'all' for a tenant admin or a user with `access_all_locations`, else the explicit
   * UserLocation id list.
   */
  private async permittedLocationIds(user: AccessPayload): Promise<'all' | number[]> {
    if (user.isBusinessAdmin) return 'all';
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        permissions: { include: { permission: true } },
        locations: { select: { locationId: true } },
      },
    });
    const perms = new Set<string>();
    dbUser?.roles.forEach((r) => r.role.permissions.forEach((rp) => perms.add(rp.permission.name)));
    dbUser?.permissions.forEach((up) => perms.add(up.permission.name));
    if (perms.has(ACCESS_ALL)) return 'all';
    return dbUser?.locations.map((l) => l.locationId) ?? [];
  }

  /** GET /business/locations — paginated + searchable list (the DataTable feed). */
  async findAll(
    user: AccessPayload,
    query: { page: number; pageSize: number; search: string },
  ) {
    const businessId = user.businessId as number;
    const permitted = await this.permittedLocationIds(user);

    const s = query.search.trim();
    const where: Prisma.BusinessLocationWhereInput = {
      businessId,
      deletedAt: null,
      ...(permitted === 'all' ? {} : { id: { in: permitted.length ? permitted : [-1] } }),
      ...(s
        ? {
            OR: [
              { name: { contains: s, mode: 'insensitive' } },
              { locationId: { contains: s, mode: 'insensitive' } },
              { city: { contains: s, mode: 'insensitive' } },
              { state: { contains: s, mode: 'insensitive' } },
              { country: { contains: s, mode: 'insensitive' } },
              { landmark: { contains: s, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.businessLocation.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { name: 'asc' },
      }),
      this.prisma.businessLocation.count({ where }),
    ]);

    // Resolve invoice-scheme names for the list (Invoice Schemes module exists now).
    const schemeIds = [...new Set(rows.map((r) => r.invoiceSchemeId).filter((v) => v > 0))];
    const schemes = schemeIds.length
      ? await this.prisma.invoiceScheme.findMany({
          where: { businessId, id: { in: schemeIds } },
          select: { id: true, name: true },
        })
      : [];
    const schemeName = new Map(schemes.map((s) => [s.id, s.name]));

    return {
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        locationId: r.locationId,
        landmark: r.landmark,
        city: r.city,
        zipCode: r.zipCode,
        state: r.state,
        country: r.country,
        // Related names come from modules not built yet (Invoice Schemes/Layouts, Price Groups);
        // ids are preserved, names resolve to null for now (frontend shows "—").
        priceGroup: null as string | null,
        invoiceScheme: schemeName.get(r.invoiceSchemeId) ?? null,
        invoiceLayout: null as string | null,
        saleInvoiceLayout: null as string | null,
        sellingPriceGroupId: r.sellingPriceGroupId,
        invoiceSchemeId: r.invoiceSchemeId,
        invoiceLayoutId: r.invoiceLayoutId,
        saleInvoiceLayoutId: r.saleInvoiceLayoutId,
        isActive: r.isActive,
      })),
      total,
    };
  }

  /**
   * GET /business/locations/options — dropdown data for the add/edit form.
   * Invoice schemes/layouts, price groups and accounts belong to modules not yet built, so those
   * lists are empty for now (same stance as business-settings). Payment types + custom-field
   * labels come from the business's custom_labels.
   */
  async getOptions(businessId: number) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { customLabels: true },
    });
    if (!business) throw new NotFoundException('Business not found');

    const [f1, f2, f3, f4] = locationCustomFieldLabels(business.customLabels);

    // Invoice schemes are a real module now — feed the dropdown from the invoice_schemes table.
    const schemes = await this.prisma.invoiceScheme.findMany({
      where: { businessId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true },
    });

    return {
      invoiceSchemes: schemes.map((s) => ({ value: s.id, label: s.name })),
      invoiceLayouts: [] as { value: number; label: string }[], // Invoice Layouts module — pending
      priceGroups: [] as { value: number; label: string }[], // Selling Price Groups module — pending
      accounts: [] as { value: number; label: string }[], // Accounts module — pending
      paymentTypes: buildPaymentTypes(business.customLabels),
      customFieldLabels: { custom_field1: f1, custom_field2: f2, custom_field3: f3, custom_field4: f4 },
    };
  }

  /** GET /business/locations/:id — single location for the edit form. */
  async findOne(businessId: number, id: number) {
    const r = await this.prisma.businessLocation.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!r) throw new NotFoundException('Business location not found');
    return {
      id: r.id,
      name: r.name,
      locationId: r.locationId ?? '',
      landmark: r.landmark ?? '',
      city: r.city,
      state: r.state,
      country: r.country,
      zipCode: r.zipCode,
      mobile: r.mobile ?? '',
      alternateNumber: r.alternateNumber ?? '',
      email: r.email ?? '',
      website: r.website ?? '',
      invoiceSchemeId: r.invoiceSchemeId,
      invoiceLayoutId: r.invoiceLayoutId,
      saleInvoiceLayoutId: r.saleInvoiceLayoutId,
      sellingPriceGroupId: r.sellingPriceGroupId,
      customField1: r.customField1 ?? '',
      customField2: r.customField2 ?? '',
      customField3: r.customField3 ?? '',
      customField4: r.customField4 ?? '',
      defaultPaymentAccounts: (r.defaultPaymentAccounts ?? {}) as Record<string, unknown>,
      featuredProducts: (r.featuredProducts ?? []) as unknown[],
      isActive: r.isActive,
    };
  }

  /** POST /business/locations — create a location (GOURI @store). */
  async create(businessId: number, dto: SaveBusinessLocationDto) {
    await this.assertUniqueName(businessId, dto.name);

    // GOURI always advances the per-business reference counter on create (setAndGetReferenceCount),
    // and only *uses* the generated code when no location_id was supplied.
    const refCount = await this.incrementReferenceCount(businessId);

    let locationId = blank(dto.location_id ?? null);
    if (locationId) {
      await this.assertUniqueLocationId(businessId, locationId);
    } else {
      locationId = await this.formatLocationId(businessId, refCount);
    }

    const created = await this.prisma.businessLocation.create({
      data: {
        businessId,
        name: dto.name,
        locationId,
        landmark: blank(dto.landmark ?? null),
        city: dto.city,
        state: dto.state,
        country: dto.country,
        zipCode: dto.zip_code,
        mobile: blank(dto.mobile ?? null),
        alternateNumber: blank(dto.alternate_number ?? null),
        email: blank(dto.email ?? null),
        website: blank(dto.website ?? null),
        // NOT-NULL in GOURI; default to 0 until the Invoice modules exist (documented in the DTO).
        invoiceSchemeId: dto.invoice_scheme_id ?? 0,
        invoiceLayoutId: dto.invoice_layout_id ?? 0,
        saleInvoiceLayoutId: dto.sale_invoice_layout_id ?? null,
        sellingPriceGroupId: dto.selling_price_group_id ?? null,
        customField1: blank(dto.custom_field1 ?? null),
        customField2: blank(dto.custom_field2 ?? null),
        customField3: blank(dto.custom_field3 ?? null),
        customField4: blank(dto.custom_field4 ?? null),
        defaultPaymentAccounts: this.jsonOrNull(dto.default_payment_accounts),
        featuredProducts: this.jsonOrNull(dto.featured_products),
      },
    });

    // GOURI creates a per-location permission `location.{id}` on store.
    await this.prisma.permission.upsert({
      where: { name: `location.${created.id}` },
      update: {},
      create: { name: `location.${created.id}`, resource: 'location', action: String(created.id) },
    });

    return this.findOne(businessId, created.id);
  }

  /** PATCH /business/locations/:id — update a location (GOURI @update). */
  async update(businessId: number, id: number, dto: SaveBusinessLocationDto) {
    await this.findOne(businessId, id); // 404 if not in this business
    await this.assertUniqueName(businessId, dto.name, id);

    const locationId = blank(dto.location_id ?? null);
    if (locationId) await this.assertUniqueLocationId(businessId, locationId, id);

    await this.prisma.businessLocation.update({
      where: { id },
      data: {
        name: dto.name,
        locationId,
        landmark: blank(dto.landmark ?? null),
        city: dto.city,
        state: dto.state,
        country: dto.country,
        zipCode: dto.zip_code,
        mobile: blank(dto.mobile ?? null),
        alternateNumber: blank(dto.alternate_number ?? null),
        email: blank(dto.email ?? null),
        website: blank(dto.website ?? null),
        invoiceSchemeId: dto.invoice_scheme_id ?? 0,
        invoiceLayoutId: dto.invoice_layout_id ?? 0,
        saleInvoiceLayoutId: dto.sale_invoice_layout_id ?? null,
        sellingPriceGroupId: dto.selling_price_group_id ?? null,
        customField1: blank(dto.custom_field1 ?? null),
        customField2: blank(dto.custom_field2 ?? null),
        customField3: blank(dto.custom_field3 ?? null),
        customField4: blank(dto.custom_field4 ?? null),
        defaultPaymentAccounts: this.jsonOrNull(dto.default_payment_accounts),
        featuredProducts: this.jsonOrNull(dto.featured_products),
      },
    });
    return this.findOne(businessId, id);
  }

  /**
   * POST /business/locations/:id/activate-deactivate — toggle is_active (GOURI @activateDeactivateLocation).
   * GOURI blocks deactivation while a cash register is open for the location; the Cash Register module
   * isn't built yet, so that guard is a no-op here (documented) and the toggle always proceeds.
   */
  async activateDeactivate(businessId: number, id: number) {
    const location = await this.prisma.businessLocation.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!location) throw new NotFoundException('Business location not found');

    const updated = await this.prisma.businessLocation.update({
      where: { id },
      data: { isActive: !location.isActive },
    });
    // Return a plain object (no `success` key) so the global ResponseInterceptor wraps it in the
    // standard `{ success, data }` envelope, matching every other endpoint the frontend consumes.
    return {
      isActive: updated.isActive,
      msg: updated.isActive
        ? 'Business location activated successfully'
        : 'Business location deactivated successfully',
    };
  }

  /**
   * GET /business/locations/check-location-id — uniqueness check for the location_id field
   * (GOURI @checkLocationId). `valid` is false when the id is already taken by another location.
   */
  async checkLocationId(businessId: number, locationId?: string, hiddenId?: number) {
    if (!locationId) return { valid: true };
    const count = await this.prisma.businessLocation.count({
      where: {
        businessId,
        locationId,
        ...(hiddenId ? { id: { not: hiddenId } } : {}),
      },
    });
    return { valid: count === 0 };
  }

  // ---- helpers ----

  private jsonOrNull(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (v == null) return Prisma.JsonNull;
    if (Array.isArray(v) && v.length === 0) return Prisma.JsonNull;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return Prisma.JsonNull;
    return v as Prisma.InputJsonValue;
  }

  private async assertUniqueName(businessId: number, name: string, exceptId?: number): Promise<void> {
    const found = await this.prisma.businessLocation.findFirst({
      where: {
        businessId,
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (found) throw new ConflictException('A location with this name already exists');
  }

  private async assertUniqueLocationId(
    businessId: number,
    locationId: string,
    exceptId?: number,
  ): Promise<void> {
    const found = await this.prisma.businessLocation.findFirst({
      where: {
        businessId,
        locationId,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (found) throw new ConflictException('This Location ID is already in use');
  }

  /**
   * Increment & return the per-(business, business_location) reference counter — mirrors
   * Util::setAndGetReferenceCount (creates the row at 1 on first use, else +1).
   */
  private async incrementReferenceCount(businessId: number): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.referenceCount.findFirst({
        where: { businessId, refType: REF_TYPE },
      });
      if (existing) {
        const updated = await tx.referenceCount.update({
          where: { id: existing.id },
          data: { refCount: existing.refCount + 1 },
        });
        return updated.refCount;
      }
      const created = await tx.referenceCount.create({
        data: { businessId, refType: REF_TYPE, refCount: 1 },
      });
      return created.refCount;
    });
  }

  /**
   * Format a location code from the reference count, applying the `business_location` prefix from
   * `ref_no_prefixes` — mirrors generateReferenceNumber (business_location = `prefix + 4-digit`, no year).
   */
  private async formatLocationId(businessId: number, refCount: number): Promise<string> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { refNoPrefixes: true },
    });
    const prefixes = (business?.refNoPrefixes ?? {}) as Record<string, string>;
    const prefix = prefixes[REF_TYPE] ?? '';
    return `${prefix}${String(refCount).padStart(4, '0')}`;
  }
}
