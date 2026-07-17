import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Contact, type PayTermType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { formatContactId, toPayTermType, typesFor } from './contacts.constants';
import type { ListContactsQueryDto } from './dto/list-contacts.query';
import type { SaveContactDto } from './dto/save-contact.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);
const toPayTerm = (v?: string | null): PayTermType | null => toPayTermType(v);

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  private addressOf(c: {
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    zipCode: string | null;
  }): string {
    return [c.addressLine1, c.addressLine2, c.city, c.state, c.country, c.zipCode]
      .map((p) => p?.trim())
      .filter(Boolean)
      .join(', ');
  }

  /**
   * GET /contacts — shared suppliers/customers list (server-side paginated).
   * NOTE: money columns (opening balance, purchase/sell due, return due, reward points) are
   * transaction-derived and returned as `null` until the transaction-core module lands.
   */
  async findAll(businessId: number, query: ListContactsQueryDto) {
    const search = query.search.trim();
    const where: Prisma.ContactWhereInput = {
      businessId,
      deletedAt: null,
      type: { in: typesFor(query.type) },
      ...(query.status ? { contactStatus: query.status } : {}),
      ...(query.type === 'customer' && query.customerGroupId
        ? { customerGroupId: query.customerGroupId }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { supplierBusinessName: { contains: search, mode: 'insensitive' } },
              { contactId: { contains: search, mode: 'insensitive' } },
              { mobile: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { taxNumber: { contains: search, mode: 'insensitive' } },
              { city: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.contact.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { id: 'desc' }, // stable newest-first (createdAt may be null for imported rows)
        include: { customerGroup: { select: { name: true } } },
      }),
      this.prisma.contact.count({ where }),
    ]);

    const data = rows.map((c) => ({
      id: c.id,
      contactId: c.contactId ?? '',
      type: c.type,
      supplierBusinessName: c.supplierBusinessName ?? '',
      name: c.name ?? '',
      email: c.email ?? '',
      taxNumber: c.taxNumber ?? '',
      mobile: c.mobile ?? '',
      payTermNumber: c.payTermNumber,
      payTermType: c.payTermType ? c.payTermType.toLowerCase() : null,
      creditLimit: c.creditLimit != null ? Number(c.creditLimit) : null,
      customerGroup: c.customerGroup?.name ?? '',
      customerGroupId: c.customerGroupId,
      address: this.addressOf(c),
      mobileNumber: c.mobile,
      advanceBalance: Number(c.balance), // contacts.balance = running advance balance (real column)
      contactStatus: c.contactStatus,
      isDefault: c.isDefault,
      createdAt: c.createdAt,
      customFields: [
        c.customField1, c.customField2, c.customField3, c.customField4, c.customField5,
        c.customField6, c.customField7, c.customField8, c.customField9, c.customField10,
      ].map((v) => v ?? ''),
      // Deferred (transaction-derived) — surfaced as null so the UI shows "—".
      openingBalance: null as number | null,
      totalPurchaseDue: null as number | null,
      totalPurchaseReturnDue: null as number | null,
      totalSaleDue: null as number | null,
      totalSellReturnDue: null as number | null,
      rewardPoints: null as number | null,
    }));

    return { data, total };
  }

  /** GET /contacts/meta — dropdown sources for the form/filters. */
  async meta(businessId: number) {
    const [customerGroups, users] = await this.prisma.$transaction([
      this.prisma.customerGroup.findMany({
        where: { businessId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.findMany({
        where: { businessId, userType: 'USER', deletedAt: null },
        select: { id: true, surname: true, firstName: true, lastName: true },
        orderBy: { firstName: 'asc' },
      }),
    ]);
    return {
      customerGroups,
      users: users.map((u) => ({
        id: u.id,
        name: [u.surname, u.firstName, u.lastName].filter(Boolean).join(' ').trim(),
      })),
    };
  }

  /** GET /contacts/:id — full record for the edit form / detail header. */
  async findOne(businessId: number, id: number) {
    const c = await this.prisma.contact.findFirst({
      where: { id, businessId, deletedAt: null },
      include: {
        customerGroup: { select: { id: true, name: true } },
        usersWithAccess: { select: { userId: true } },
      },
    });
    if (!c) throw new NotFoundException('Contact not found');
    return this.shapeDetail(c);
  }

  private shapeDetail(
    c: Contact & { customerGroup?: { id: number; name: string } | null; usersWithAccess?: { userId: number }[] },
  ) {
    return {
      id: c.id,
      type: c.type,
      contactTypeRadio: c.supplierBusinessName ? 'business' : 'individual',
      supplierBusinessName: c.supplierBusinessName ?? '',
      prefix: c.prefix ?? '',
      firstName: c.firstName ?? '',
      middleName: c.middleName ?? '',
      lastName: c.lastName ?? '',
      name: c.name ?? '',
      contactId: c.contactId ?? '',
      contactStatus: c.contactStatus,
      email: c.email ?? '',
      taxNumber: c.taxNumber ?? '',
      customerGroupId: c.customerGroupId,
      customerGroup: c.customerGroup?.name ?? '',
      payTermNumber: c.payTermNumber,
      payTermType: c.payTermType ? c.payTermType.toLowerCase() : null,
      creditLimit: c.creditLimit != null ? Number(c.creditLimit) : null,
      mobile: c.mobile,
      landline: c.landline ?? '',
      alternateNumber: c.alternateNumber ?? '',
      addressLine1: c.addressLine1 ?? '',
      addressLine2: c.addressLine2 ?? '',
      city: c.city ?? '',
      state: c.state ?? '',
      country: c.country ?? '',
      zipCode: c.zipCode ?? '',
      dob: c.dob ? c.dob.toISOString().slice(0, 10) : '',
      customField1: c.customField1 ?? '',
      customField2: c.customField2 ?? '',
      customField3: c.customField3 ?? '',
      customField4: c.customField4 ?? '',
      customField5: c.customField5 ?? '',
      customField6: c.customField6 ?? '',
      customField7: c.customField7 ?? '',
      customField8: c.customField8 ?? '',
      customField9: c.customField9 ?? '',
      customField10: c.customField10 ?? '',
      shippingAddress: c.shippingAddress ?? '',
      position: c.position ?? '',
      shippingCustomFieldDetails: c.shippingCustomFieldDetails ?? null,
      isExport: c.isExport,
      exportCustomField1: c.exportCustomField1 ?? '',
      exportCustomField2: c.exportCustomField2 ?? '',
      exportCustomField3: c.exportCustomField3 ?? '',
      exportCustomField4: c.exportCustomField4 ?? '',
      exportCustomField5: c.exportCustomField5 ?? '',
      exportCustomField6: c.exportCustomField6 ?? '',
      isDefault: c.isDefault,
      advanceBalance: Number(c.balance),
      assignedToUsers: c.usersWithAccess?.map((u) => u.userId) ?? [],
      createdAt: c.createdAt,
    };
  }

  /** Assemble the display `name` from the individual name parts (GOURI store/update). */
  private assembleName(dto: SaveContactDto): string | null {
    const name = [dto.prefix, dto.first_name, dto.middle_name, dto.last_name]
      .map((p) => p?.trim())
      .filter(Boolean)
      .join(' ')
      .trim();
    return name || null;
  }

  /** Next contact reference code, mirroring GOURI setAndGetReferenceCount + generateReferenceNumber. */
  private async nextContactId(tx: Prisma.TransactionClient, businessId: number): Promise<string> {
    const existing = await tx.referenceCount.findFirst({
      where: { businessId, refType: 'contacts' },
    });
    let count: number;
    if (existing) {
      count = existing.refCount + 1;
      await tx.referenceCount.update({ where: { id: existing.id }, data: { refCount: count } });
    } else {
      const created = await tx.referenceCount.create({
        data: { businessId, refType: 'contacts', refCount: 1 },
      });
      count = created.refCount;
    }
    const business = await tx.business.findUnique({
      where: { id: businessId },
      select: { refNoPrefixes: true },
    });
    const prefixes = (business?.refNoPrefixes as Record<string, string> | null) ?? null;
    const prefix = prefixes?.contacts ?? '';
    return formatContactId(prefix, count);
  }

  private async assertUniqueContactId(
    businessId: number,
    contactId: string,
    exceptId?: number,
  ): Promise<void> {
    const found = await this.prisma.contact.findFirst({
      where: { businessId, contactId, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (found) throw new ConflictException('Contact ID already exists');
  }

  private async assertCustomerGroup(businessId: number, id?: number | null): Promise<void> {
    if (!id) return;
    const cg = await this.prisma.customerGroup.findFirst({ where: { id, businessId } });
    if (!cg) throw new BadRequestException('Selected customer group is invalid');
  }

  /** Scalar column payload shared by create/update. */
  private buildData(dto: SaveContactDto) {
    const isExport = dto.is_export ?? false;
    return {
      type: dto.type,
      supplierBusinessName: blank(dto.supplier_business_name),
      name: this.assembleName(dto),
      prefix: blank(dto.prefix),
      firstName: blank(dto.first_name),
      middleName: blank(dto.middle_name),
      lastName: blank(dto.last_name),
      email: blank(dto.email),
      taxNumber: blank(dto.tax_number),
      customerGroupId: dto.customer_group_id ?? null,
      payTermNumber: dto.pay_term_number ?? null,
      payTermType: toPayTerm(dto.pay_term_type),
      creditLimit: dto.credit_limit ?? null,
      mobile: dto.mobile,
      landline: blank(dto.landline),
      alternateNumber: blank(dto.alternate_number),
      addressLine1: blank(dto.address_line_1),
      addressLine2: blank(dto.address_line_2),
      city: blank(dto.city),
      state: blank(dto.state),
      country: blank(dto.country),
      zipCode: blank(dto.zip_code),
      dob: dto.dob ? new Date(dto.dob) : null,
      customField1: blank(dto.custom_field1),
      customField2: blank(dto.custom_field2),
      customField3: blank(dto.custom_field3),
      customField4: blank(dto.custom_field4),
      customField5: blank(dto.custom_field5),
      customField6: blank(dto.custom_field6),
      customField7: blank(dto.custom_field7),
      customField8: blank(dto.custom_field8),
      customField9: blank(dto.custom_field9),
      customField10: blank(dto.custom_field10),
      shippingAddress: blank(dto.shipping_address),
      position: blank(dto.position),
      shippingCustomFieldDetails: dto.shipping_custom_field_details ?? Prisma.JsonNull,
      isExport,
      exportCustomField1: isExport ? blank(dto.export_custom_field_1) : null,
      exportCustomField2: isExport ? blank(dto.export_custom_field_2) : null,
      exportCustomField3: isExport ? blank(dto.export_custom_field_3) : null,
      exportCustomField4: isExport ? blank(dto.export_custom_field_4) : null,
      exportCustomField5: isExport ? blank(dto.export_custom_field_5) : null,
      exportCustomField6: isExport ? blank(dto.export_custom_field_6) : null,
    };
  }

  /** POST /contacts — GOURI @store (opening balance deferred; contact_id auto-generated when blank). */
  async create(businessId: number, createdBy: number, dto: SaveContactDto) {
    await this.assertCustomerGroup(businessId, dto.customer_group_id);
    if (dto.contact_id) await this.assertUniqueContactId(businessId, dto.contact_id);
    await this.assertAssignedUsers(businessId, dto.assigned_to_users);

    const id = await this.prisma.$transaction(async (tx) => {
      const contactId = dto.contact_id ? dto.contact_id : await this.nextContactId(tx, businessId);
      const contact = await tx.contact.create({
        data: {
          businessId,
          createdBy,
          contactId,
          contactStatus: 'active',
          createdAt: new Date(), // Prisma has no @default(now()); set it so "Added On" is populated
          ...this.buildData(dto),
        },
      });
      await this.syncAssignedUsers(tx, contact.id, dto.assigned_to_users ?? []);
      return contact.id;
    });
    return this.findOne(businessId, id);
  }

  /** PATCH /contacts/:id — GOURI @update. */
  async update(businessId: number, id: number, dto: SaveContactDto) {
    const existing = await this.prisma.contact.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!existing) throw new NotFoundException('Contact not found');
    await this.assertCustomerGroup(businessId, dto.customer_group_id);
    if (dto.contact_id) await this.assertUniqueContactId(businessId, dto.contact_id, id);
    await this.assertAssignedUsers(businessId, dto.assigned_to_users);

    await this.prisma.$transaction(async (tx) => {
      await tx.contact.update({
        where: { id },
        data: {
          ...this.buildData(dto),
          contactId: dto.contact_id ? dto.contact_id : existing.contactId,
        },
      });
      if (dto.assigned_to_users !== undefined) {
        await tx.userContactAccess.deleteMany({ where: { contactId: id } });
        await this.syncAssignedUsers(tx, id, dto.assigned_to_users);
      }
    });
    return this.findOne(businessId, id);
  }

  /** GET /contacts/:id/toggle-status — GOURI @updateStatus (active <-> inactive). */
  async updateStatus(businessId: number, id: number) {
    const c = await this.prisma.contact.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!c) throw new NotFoundException('Contact not found');
    const next = c.contactStatus === 'active' ? 'inactive' : 'active';
    await this.prisma.contact.update({ where: { id }, data: { contactStatus: next } });
    return { success: true, contactStatus: next };
  }

  /**
   * DELETE /contacts/:id — GOURI @destroy. Blocks the default walk-in customer. The legacy
   * "has transactions" guard is deferred (no transactions table yet).
   */
  async remove(businessId: number, id: number) {
    const c = await this.prisma.contact.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!c) throw new NotFoundException('Contact not found');
    if (c.isDefault) throw new BadRequestException('The default contact cannot be deleted');
    await this.prisma.contact.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true, msg: 'Contact deleted successfully' };
  }

  /** POST /contacts/mass-delete — GOURI @massDestroy (skips default contacts). */
  async massDestroy(businessId: number, ids: number[]) {
    const contacts = await this.prisma.contact.findMany({
      where: { id: { in: ids }, businessId, deletedAt: null },
      select: { id: true, isDefault: true },
    });
    const deletable = contacts.filter((c) => !c.isDefault).map((c) => c.id);
    if (deletable.length) {
      await this.prisma.contact.updateMany({
        where: { id: { in: deletable } },
        data: { deletedAt: new Date() },
      });
    }
    const allDeleted = deletable.length === contacts.length;
    return {
      success: true,
      deleted: deletable.length,
      msg: allDeleted ? 'Deleted successfully' : 'Some contacts could not be deleted',
    };
  }

  /** POST /contacts/check-contact-id — GOURI @checkContactId (true = available). */
  async checkContactId(businessId: number, contactId: string, exceptId?: number): Promise<boolean> {
    if (!contactId) return true;
    const found = await this.prisma.contact.findFirst({
      where: { businessId, contactId, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    return !found;
  }

  /** POST /contacts/check-mobile — GOURI @checkMobile. */
  async checkMobile(businessId: number, mobile: string, exceptId?: number) {
    const matches = await this.prisma.contact.findMany({
      where: {
        businessId,
        deletedAt: null,
        mobile: { contains: mobile },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { name: true, mobile: true },
    });
    return {
      isMobileExists: matches.length > 0,
      contacts: matches,
    };
  }

  private async assertAssignedUsers(businessId: number, userIds?: number[]): Promise<void> {
    if (!userIds?.length) return;
    const n = await this.prisma.user.count({
      where: { id: { in: userIds }, businessId, deletedAt: null },
    });
    if (n !== new Set(userIds).size) throw new BadRequestException('One or more assigned users are invalid');
  }

  private async syncAssignedUsers(
    tx: Prisma.TransactionClient,
    contactId: number,
    userIds: number[],
  ): Promise<void> {
    if (!userIds.length) return;
    await tx.userContactAccess.createMany({
      data: [...new Set(userIds)].map((userId) => ({ userId, contactId })),
      skipDuplicates: true,
    });
  }
}
