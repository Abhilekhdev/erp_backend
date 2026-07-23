import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Contact, type PayTermType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AbilityService } from '../../common/services/ability.service';
import { ReferenceNumberService } from '../../common/services/reference-number.service';
import { formatContactId, toPayTermType, typesFor } from './contacts.constants';
import { paymentStatusFor, round4 } from '../purchases/purchase.calc';
import type { AccessPayload } from '../auth/token.service';
import type { ContactLedgerQueryDto } from './dto/contact-ledger.query';
import type { ListContactsQueryDto } from './dto/list-contacts.query';
import type { SaveContactDto } from './dto/save-contact.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);
const toPayTerm = (v?: string | null): PayTermType | null => toPayTermType(v);

/** Human labels for the ledger's transaction rows. */
const LEDGER_LABEL: Record<string, string> = {
  SELL: 'Sale',
  PURCHASE: 'Purchase',
  SELL_RETURN: 'Sell return',
  PURCHASE_RETURN: 'Purchase return',
  OPENING_BALANCE: 'Opening balance',
};

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refs: ReferenceNumberService,
    private readonly ability: AbilityService,
  ) {}

  /**
   * Opening balance is what a contact already owed (customer) or was owed (supplier) before the
   * system started. GOURI never stores it on `contacts` — it writes a `transactions` row of
   * `type='opening_balance'`, and so do we. `remaining` is the figure the edit form shows (gross
   * minus anything already paid); on save we reconstruct the gross so a part-payment isn't lost.
   */
  private async syncOpeningBalance(
    tx: Prisma.TransactionClient,
    businessId: number,
    contactId: number,
    remaining: number | null | undefined,
    createdBy: number,
  ) {
    const value = round4(Number(remaining) || 0);
    const existing = await tx.transaction.findFirst({
      where: { businessId, contactId, type: 'OPENING_BALANCE' },
      select: { id: true },
    });

    if (existing) {
      const agg = await tx.transactionPayment.aggregate({ where: { transactionId: existing.id }, _sum: { amount: true } });
      const paid = Number(agg._sum.amount ?? 0);
      const gross = round4(value + paid); // form value is the remaining; add paid back to gross
      await tx.transaction.update({
        where: { id: existing.id },
        // GOURI updates only final_total on edit, never total_before_tax — kept.
        data: { finalTotal: gross, paymentStatus: paymentStatusFor(gross, paid) },
      });
      return;
    }
    if (value <= 0) return;

    // A fresh opening balance: dated now, at the business's FIRST location (GOURI's `->first()`).
    const location = await tx.businessLocation.findFirst({
      where: { businessId, deletedAt: null },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (!location) return; // no location yet — nothing to hang it on
    const refNo = await this.refs.generate(businessId, 'opening_balance', 'OB');
    await tx.transaction.create({
      data: {
        businessId,
        locationId: location.id,
        contactId,
        type: 'OPENING_BALANCE',
        status: 'FINAL',
        paymentStatus: 'DUE',
        refNo,
        transactionDate: new Date(),
        lineSubtotal: value,
        finalTotal: value,
        createdBy,
      },
    });
  }

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
   * NOTE: purchase due is now derived from real purchases. The rest of the money columns (opening
   * balance, sell due, return dues, reward points) stay `null` until their modules land.
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

    // What each supplier is owed on purchases. Derived, never stored: total billed minus total
    // paid, exactly as GOURI computes its "Payment Due" column at read time.
    const contactIds = rows.map((c) => c.id);
    // Each due figure is billed minus paid, derived at read time exactly as GOURI does — nothing is
    // stored. Only FINAL sells count (drafts/quotations are excluded), mirroring GOURI's queries.
    const [purchBilled, purchPaid, sellBilled, sellPaid, retBilled, retPaid, obBilled] = contactIds.length
      ? await Promise.all([
          this.prisma.transaction.groupBy({
            by: ['contactId'],
            where: { businessId, type: 'PURCHASE', contactId: { in: contactIds } },
            _sum: { finalTotal: true },
          }),
          this.prisma.transactionPayment.groupBy({
            by: ['paymentFor'],
            where: { businessId, paymentFor: { in: contactIds }, transaction: { type: 'PURCHASE' } },
            _sum: { amount: true },
          }),
          this.prisma.transaction.groupBy({
            by: ['contactId'],
            where: { businessId, type: 'SELL', status: 'FINAL', contactId: { in: contactIds } },
            _sum: { finalTotal: true },
          }),
          this.prisma.transactionPayment.groupBy({
            by: ['paymentFor'],
            where: {
              businessId,
              paymentFor: { in: contactIds },
              transaction: { type: 'SELL', status: 'FINAL' },
            },
            _sum: { amount: true },
          }),
          this.prisma.transaction.groupBy({
            by: ['contactId'],
            where: { businessId, type: 'SELL_RETURN', contactId: { in: contactIds } },
            _sum: { finalTotal: true },
          }),
          this.prisma.transactionPayment.groupBy({
            by: ['paymentFor'],
            where: { businessId, paymentFor: { in: contactIds }, transaction: { type: 'SELL_RETURN' } },
            _sum: { amount: true },
          }),
          // Opening balance is a standalone column (GOURI does NOT fold it into purchase/sale due).
          this.prisma.transaction.groupBy({
            by: ['contactId'],
            where: { businessId, type: 'OPENING_BALANCE', contactId: { in: contactIds } },
            _sum: { finalTotal: true },
          }),
        ])
      : [[], [], [], [], [], [], []];
    const sumBy = (
      list: { contactId?: number | null; paymentFor?: number | null; _sum: { finalTotal?: unknown; amount?: unknown } }[],
      key: 'finalTotal' | 'amount',
    ) =>
      new Map(
        list.map((r) => [
          (r.contactId ?? r.paymentFor) as number,
          Number((r._sum as Record<string, unknown>)[key] ?? 0),
        ]),
      );
    const billedBy = sumBy(purchBilled, 'finalTotal');
    const paidBy = sumBy(purchPaid, 'amount');
    const sellBilledBy = sumBy(sellBilled, 'finalTotal');
    const sellPaidBy = sumBy(sellPaid, 'amount');
    const retBilledBy = sumBy(retBilled, 'finalTotal');
    const retPaidBy = sumBy(retPaid, 'amount');
    const obBy = sumBy(obBilled, 'finalTotal');

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
      // Derived from real transactions (billed − paid). Live now that purchases and sells exist.
      totalPurchaseDue: round4((billedBy.get(c.id) ?? 0) - (paidBy.get(c.id) ?? 0)),
      totalSaleDue: round4((sellBilledBy.get(c.id) ?? 0) - (sellPaidBy.get(c.id) ?? 0)),
      totalSellReturnDue: round4((retBilledBy.get(c.id) ?? 0) - (retPaidBy.get(c.id) ?? 0)),
      // Still their own modules — surfaced as null so the UI shows "—", never a fake 0.
      // Gross opening balance, its own column — GOURI shows it standalone, not merged into due.
      openingBalance: round4(obBy.get(c.id) ?? 0),
      totalPurchaseReturnDue: null as number | null,
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
    // The edit form shows opening balance as what is STILL owed (gross minus paid), the same
    // figure syncOpeningBalance expects back on save.
    const ob = await this.prisma.transaction.findFirst({
      where: { businessId, contactId: id, type: 'OPENING_BALANCE' },
      select: { finalTotal: true, payments: { select: { amount: true } } },
    });
    const obRemaining = ob
      ? round4(Number(ob.finalTotal) - ob.payments.reduce((s, p) => s + Number(p.amount), 0))
      : 0;
    return { ...this.shapeDetail(c), openingBalance: obRemaining };
  }

  /**
   * The contact ledger — a running statement (GOURI's `format_1`): every transaction and payment as
   * a debit or credit line, a running balance, and a summary header. Debit/credit follow GOURI's
   * `getLedgerDetails`: a sell debits a customer (a receivable), a purchase credits a supplier, a
   * payment against a sale/opening-balance credits it back, etc. Read-only.
   */
  async ledger(user: AccessPayload, contactId: number, query: ContactLedgerQueryDto) {
    const businessId = user.businessId as number;
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, businessId, deletedAt: null },
      select: { id: true, type: true, name: true, supplierBusinessName: true, balance: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    if (!(await this.ability.can(user, 'supplier.view')) && !(await this.ability.can(user, 'customer.view'))) {
      // view_own falls through to the same read; per-contact scoping isn't modelled here.
    }

    const end = query.dateTo ? new Date(new Date(query.dateTo).setHours(23, 59, 59, 999)) : undefined;
    const start = query.dateFrom ? new Date(new Date(query.dateFrom).setHours(0, 0, 0, 0)) : undefined;
    const locationFilter = query.locationId ? { locationId: query.locationId } : {};

    // Contact-affecting documents. A sell only counts once final; drafts never.
    const txns = await this.prisma.transaction.findMany({
      where: {
        businessId,
        contactId,
        ...locationFilter,
        type: { in: ['SELL', 'PURCHASE', 'SELL_RETURN', 'PURCHASE_RETURN', 'OPENING_BALANCE'] },
        status: { not: 'DRAFT' },
        ...(end ? { transactionDate: { lte: end } } : {}),
      },
      select: { id: true, type: true, status: true, refNo: true, transactionDate: true, finalTotal: true, paymentStatus: true, location: { select: { name: true } } },
      orderBy: { transactionDate: 'asc' },
    });
    const payments = await this.prisma.transactionPayment.findMany({
      where: {
        businessId,
        paymentFor: contactId,
        transaction: { type: { in: ['SELL', 'PURCHASE', 'SELL_RETURN', 'PURCHASE_RETURN', 'OPENING_BALANCE'] } },
        ...(end ? { paidOn: { lte: end } } : {}),
      },
      select: { id: true, amount: true, method: true, paymentRefNo: true, paidOn: true, isReturn: true, note: true, transaction: { select: { type: true, refNo: true, location: { select: { name: true } } } } },
      orderBy: { paidOn: 'asc' },
    });

    const isCustomerSide = contact.type === 'customer' || contact.type === 'both';

    type Row = { date: Date; refNo: string; type: string; label: string; location: string; paymentStatus: string | null; method: string | null; debit: number; credit: number; note: string; balance?: number };
    const rows: Row[] = [];

    for (const t of txns) {
      if (t.type === 'SELL' && t.status !== 'FINAL') continue;
      let debit = 0;
      let credit = 0;
      if (t.type === 'SELL' || t.type === 'PURCHASE_RETURN') debit = Number(t.finalTotal);
      else if (t.type === 'PURCHASE' || t.type === 'SELL_RETURN') credit = Number(t.finalTotal);
      else if (t.type === 'OPENING_BALANCE') {
        // GOURI: debit for a customer, credit for a supplier. We treat `both` as customer-side.
        if (isCustomerSide) debit = Number(t.finalTotal);
        else credit = Number(t.finalTotal);
      }
      rows.push({
        date: t.transactionDate,
        refNo: t.refNo,
        type: t.type.toLowerCase(),
        label: LEDGER_LABEL[t.type] ?? t.type,
        location: t.location.name,
        paymentStatus: t.type === 'OPENING_BALANCE' ? null : t.paymentStatus.toLowerCase(),
        method: null,
        debit: round4(debit),
        credit: round4(credit),
        note: '',
      });
    }

    for (const p of payments) {
      const pt = p.transaction?.type;
      let debit = 0;
      let credit = 0;
      // A payment against a purchase or a sell-return is money we PAID (debit). A payment against a
      // sale, purchase-return or opening balance is money RECEIVED (credit). is_return flips it.
      const receivedSide = pt === 'SELL' || pt === 'PURCHASE_RETURN' || pt === 'OPENING_BALANCE';
      if (receivedSide) {
        if (p.isReturn) debit = Number(p.amount);
        else credit = Number(p.amount);
      } else {
        if (p.isReturn) credit = Number(p.amount);
        else debit = Number(p.amount);
      }
      rows.push({
        date: p.paidOn,
        refNo: p.paymentRefNo ?? '',
        type: 'payment',
        label: 'Payment',
        location: p.transaction?.location?.name ?? '',
        paymentStatus: null,
        method: p.method,
        debit: round4(debit),
        credit: round4(credit),
        note: [p.note, p.transaction?.refNo ? `For ${p.transaction.refNo}` : ''].filter(Boolean).join(' · '),
      });
    }

    rows.sort((a, b) => a.date.getTime() - b.date.getTime() || a.type.localeCompare(b.type));

    // Everything before the window is folded into the opening running balance.
    let beginningBalance = 0;
    const windowRows: Row[] = [];
    for (const r of rows) {
      if (start && r.date < start) beginningBalance = round4(beginningBalance + r.credit - r.debit);
      else windowRows.push(r);
    }

    let bal = beginningBalance;
    for (const r of windowRows) {
      bal = round4(bal + r.credit - r.debit);
      r.balance = bal;
    }

    // Summary figures (over the whole window, all-time when no start).
    const listed = windowRows;
    const totalInvoice = round4(listed.filter((r) => r.type === 'sell').reduce((s, r) => s + r.debit, 0) - listed.filter((r) => r.type === 'sell_return').reduce((s, r) => s + r.credit, 0));
    const totalPurchase = round4(listed.filter((r) => r.type === 'purchase').reduce((s, r) => s + r.credit, 0) - listed.filter((r) => r.type === 'purchase_return').reduce((s, r) => s + r.debit, 0));
    const totalPaid = round4(listed.filter((r) => r.type === 'payment').reduce((s, r) => s + r.debit + r.credit, 0));

    return {
      contact: { id: contact.id, name: contact.name || contact.supplierBusinessName || '', type: contact.type },
      openingBalance: beginningBalance,
      totalInvoice,
      totalPurchase,
      totalPaid,
      advanceBalance: Number(contact.balance),
      // Positive => the contact owes us (a customer receivable); negative => we owe them.
      balanceDue: round4(-bal),
      rows: windowRows.map((r) => ({
        date: r.date,
        refNo: r.refNo,
        type: r.type,
        label: r.label,
        location: r.location,
        paymentStatus: r.paymentStatus,
        method: r.method,
        debit: r.debit || null,
        credit: r.credit || null,
        balance: r.balance ?? 0,
        note: r.note,
      })),
    };
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
      await this.syncOpeningBalance(tx, businessId, contact.id, dto.opening_balance, createdBy);
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
      if (dto.opening_balance !== undefined) {
        await this.syncOpeningBalance(tx, businessId, id, dto.opening_balance, existing.createdBy);
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
