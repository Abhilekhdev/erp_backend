import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AbilityService } from '../../common/services/ability.service';
import { StorageService, type UploadedFileLike } from '../../common/services/storage.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AccessPayload } from '../auth/token.service';
import type { ChangeClaimStatusDto, SaveClaimDto } from './dto/claim.dto';
import type { ClaimsQueryDto } from './dto/claims-query.dto';

const APPROVE = 'essentials.approve_claim_reimbursement';

const fmt = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : '');
const fullName = (u: { surname: string | null; firstName: string; lastName: string | null }): string =>
  [u.surname, u.firstName, u.lastName].filter(Boolean).join(' ').trim();
const mapStatus = (s: string): 'PENDING' | 'APPROVED' | 'UNAPPROVED' =>
  s.toUpperCase() as 'PENDING' | 'APPROVED' | 'UNAPPROVED';
const statusLabel = (s: string): string =>
  s === 'APPROVED' ? 'Approved' : s === 'UNAPPROVED' ? 'UnApproved' : 'Pending';

// Allowed document types — matches the product brochure allow-list (doc/sheet/image/pdf).
const ALLOWED_DOC = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];
const MAX_DOC_BYTES = 5 * 1024 * 1024;

type ClaimRow = Prisma.ClaimReimbursementGetPayload<{
  include: { category: true; employees: { include: { user: true } } };
}>;

@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ability: AbilityService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  private async userName(userId: number): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { surname: true, firstName: true, lastName: true },
    });
    return u ? fullName(u) : 'An employee';
  }

  /**
   * The user ids an "own-claim" (non-approver) user may see: themselves + every recursive
   * subordinate (users whose `parentId` chain leads back to them). Mirrors GOURI's `managerUsers`
   * + self scoping, and matches the leaves module.
   */
  private async ownScopeUserIds(businessId: number, userId: number): Promise<number[]> {
    const all = await this.prisma.user.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true, parentId: true },
    });
    const childrenOf = new Map<number, number[]>();
    for (const u of all) {
      if (u.parentId != null) {
        const list = childrenOf.get(u.parentId) ?? [];
        list.push(u.id);
        childrenOf.set(u.parentId, list);
      }
    }
    const result = new Set<number>([userId]);
    const stack = [userId];
    while (stack.length) {
      const cur = stack.pop() as number;
      for (const child of childrenOf.get(cur) ?? []) {
        if (!result.has(child)) {
          result.add(child);
          stack.push(child);
        }
      }
    }
    return [...result];
  }

  private async shape(c: ClaimRow) {
    const document = c.document ?? null;
    return {
      id: c.id,
      refNo: c.refNo,
      description: c.description,
      amount: Number(c.amount),
      categoryId: c.categoryId,
      category: c.category?.name ?? null,
      subCategoryId: c.subCategoryId,
      applicableDate: fmt(c.applicableDate),
      document,
      documentUrl: document ? await this.storage.url(document) : null,
      status: c.status.toLowerCase(),
      statusLabel: statusLabel(c.status),
      statusNote: c.statusNote ?? '',
      employees: c.employees.map((e) => e.userId),
      employeeNames: c.employees.map((e) => fullName(e.user)),
    };
  }

  // ── dropdowns ──────────────────────────────────────────
  async meta(businessId: number, user: AccessPayload) {
    const canApprove = await this.ability.can(user, APPROVE);
    const [categories, employees] = await Promise.all([
      this.prisma.claimReimbursementCategory.findMany({
        where: { businessId, deletedAt: null, parentId: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      canApprove
        ? this.prisma.user.findMany({
            where: { businessId, userType: 'USER', deletedAt: null, isCmmsnAgnt: false },
            select: { id: true, surname: true, firstName: true, lastName: true },
            orderBy: { firstName: 'asc' },
          })
        : Promise.resolve([]),
    ]);
    return {
      categories,
      employees: employees.map((u) => ({ id: u.id, name: fullName(u) })),
      statuses: [
        { value: 'pending', label: 'Pending' },
        { value: 'approved', label: 'Approved' },
        { value: 'unapproved', label: 'UnApproved' },
      ],
      canApprove,
    };
  }

  /** Sub-categories of a parent category (the dependent dropdown). */
  async subCategories(businessId: number, parentId: number) {
    const rows = await this.prisma.claimReimbursementCategory.findMany({
      where: { businessId, deletedAt: null, parentId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return rows;
  }

  // ── list / create / update / status / delete ───────────
  async findAll(businessId: number, query: ClaimsQueryDto, user: AccessPayload) {
    const canApprove = await this.ability.can(user, APPROVE);
    const s = query.search?.trim();
    // Non-approvers only see claims belonging to themselves or their subordinates.
    const scopeIds = canApprove ? null : await this.ownScopeUserIds(businessId, user.sub);

    const where: Prisma.ClaimReimbursementWhereInput = {
      businessId,
      ...(scopeIds ? { employees: { some: { userId: { in: scopeIds } } } } : {}),
      ...(query.userId && canApprove ? { employees: { some: { userId: query.userId } } } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.status ? { status: mapStatus(query.status) } : {}),
      ...(s
        ? {
            OR: [
              { refNo: { contains: s, mode: 'insensitive' } },
              { description: { contains: s, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.claimReimbursement.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { id: 'desc' },
        include: { category: true, employees: { include: { user: true } } },
      }),
      this.prisma.claimReimbursement.count({ where }),
    ]);
    return {
      data: await Promise.all(rows.map((r) => this.shape(r))),
      total,
      canApprove,
    };
  }

  async findOne(businessId: number, id: number) {
    const c = await this.prisma.claimReimbursement.findFirst({
      where: { id, businessId },
      include: { category: true, employees: { include: { user: true } } },
    });
    if (!c) throw new NotFoundException('Claim not found');
    return this.shape(c);
  }

  /** Validate a submitted category / sub-category belongs to the business (and the sub to its parent). */
  private async validateCategory(businessId: number, categoryId?: number, subCategoryId?: number) {
    if (categoryId) {
      const cat = await this.prisma.claimReimbursementCategory.findFirst({
        where: { id: categoryId, businessId, deletedAt: null, parentId: null },
      });
      if (!cat) throw new BadRequestException('Selected category is invalid');
    }
    if (subCategoryId) {
      const sub = await this.prisma.claimReimbursementCategory.findFirst({
        where: { id: subCategoryId, businessId, deletedAt: null },
      });
      if (!sub) throw new BadRequestException('Selected sub-category is invalid');
      if (categoryId && sub.parentId !== categoryId) {
        throw new BadRequestException('Sub-category does not belong to the selected category');
      }
    }
  }

  /** Resolve which employees a claim is for. Approvers may assign to others; everyone else gets self. */
  private async resolveEmployees(
    businessId: number,
    user: AccessPayload,
    canApprove: boolean,
    requested: number[],
  ): Promise<number[]> {
    if (!canApprove || requested.length === 0) return [user.sub];
    const valid = await this.prisma.user.findMany({
      where: { businessId, deletedAt: null, id: { in: requested } },
      select: { id: true },
    });
    if (valid.length !== new Set(requested).size) {
      throw new BadRequestException('One or more selected employees are invalid');
    }
    return valid.map((u) => u.id);
  }

  private assertDocument(file?: UploadedFileLike) {
    if (!file) return;
    if (!ALLOWED_DOC.includes(file.mimetype)) {
      throw new BadRequestException('Unsupported document type');
    }
    if (file.size > MAX_DOC_BYTES) {
      throw new BadRequestException('That file is too large to upload. Please upload a file under 5 MB.');
    }
  }

  async create(businessId: number, user: AccessPayload, dto: SaveClaimDto, file?: UploadedFileLike) {
    const canApprove = await this.ability.can(user, APPROVE);
    await this.validateCategory(businessId, dto.categoryId, dto.subCategoryId);
    const employeeIds = await this.resolveEmployees(businessId, user, canApprove, dto.employees);
    this.assertDocument(file);

    // Only an approver may pre-set the status; a normal user's claim starts Pending.
    const status = canApprove && dto.status ? mapStatus(dto.status) : 'PENDING';
    const stored = file ? await this.storage.put('claim_reimbursement', file, businessId) : null;

    const id = await this.prisma.$transaction(async (tx) => {
      const created = await tx.claimReimbursement.create({
        data: {
          businessId,
          description: dto.description,
          amount: dto.amount,
          categoryId: dto.categoryId ?? null,
          subCategoryId: dto.subCategoryId ?? null,
          applicableDate: dto.applicableDate ? new Date(dto.applicableDate) : null,
          document: stored?.path ?? null,
          status,
          ...(status !== 'PENDING' ? { changedBy: user.sub, changedAt: new Date() } : {}),
        },
      });
      await tx.claimReimbursement.update({
        where: { id: created.id },
        data: { refNo: `CLM${created.id.toString().padStart(4, '0')}` },
      });
      await tx.userClaimReimbursement.createMany({
        data: employeeIds.map((userId) => ({ businessId, claimReimbursementId: created.id, userId })),
        skipDuplicates: true,
      });
      return created.id;
    });

    return this.findOne(businessId, id);
  }

  async update(
    businessId: number,
    user: AccessPayload,
    id: number,
    dto: SaveClaimDto,
    file?: UploadedFileLike,
  ) {
    const existing = await this.prisma.claimReimbursement.findFirst({ where: { id, businessId } });
    if (!existing) throw new NotFoundException('Claim not found');
    // GOURI hides the edit button once a claim is approved/rejected; enforce it server-side.
    if (existing.status !== 'PENDING') {
      throw new BadRequestException('A claim can only be edited while it is pending');
    }
    const canApprove = await this.ability.can(user, APPROVE);
    await this.validateCategory(businessId, dto.categoryId, dto.subCategoryId);
    const employeeIds = await this.resolveEmployees(businessId, user, canApprove, dto.employees);
    this.assertDocument(file);

    // Replace the document only when a new one is uploaded; drop the old file if so.
    const stored = file ? await this.storage.put('claim_reimbursement', file, businessId) : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.claimReimbursement.update({
        where: { id },
        data: {
          description: dto.description,
          amount: dto.amount,
          categoryId: dto.categoryId ?? null,
          subCategoryId: dto.subCategoryId ?? null,
          applicableDate: dto.applicableDate ? new Date(dto.applicableDate) : null,
          ...(stored ? { document: stored.path } : {}),
        },
      });
      await tx.userClaimReimbursement.deleteMany({ where: { claimReimbursementId: id } });
      await tx.userClaimReimbursement.createMany({
        data: employeeIds.map((userId) => ({ businessId, claimReimbursementId: id, userId })),
        skipDuplicates: true,
      });
    });

    if (stored && existing.document) await this.storage.remove(existing.document);
    return this.findOne(businessId, id);
  }

  async changeStatus(
    businessId: number,
    id: number,
    user: AccessPayload,
    dto: ChangeClaimStatusDto,
  ) {
    const claim = await this.prisma.claimReimbursement.findFirst({
      where: { id, businessId },
      include: { employees: { include: { user: { select: { parentId: true } } } } },
    });
    if (!claim) throw new NotFoundException('Claim not found');

    // Who may change status: an approver, or the direct manager (parentId) of any claimant.
    const canApprove = await this.ability.can(user, APPROVE);
    const isManager = claim.employees.some((e) => e.user.parentId === user.sub);
    if (!canApprove && !isManager) {
      throw new ForbiddenException('You are not allowed to change this claim status');
    }

    const newStatus = mapStatus(dto.status);
    await this.prisma.claimReimbursement.update({
      where: { id },
      data: {
        status: newStatus,
        statusNote: dto.statusNote?.trim() || null,
        changedBy: user.sub,
        changedAt: new Date(),
      },
    });

    // GOURI emails the claimant on status change; we drop an in-app notification instead
    // (reliable, no SMTP dependency — same choice as the leaves flow).
    if (newStatus !== claim.status) {
      const label = statusLabel(newStatus);
      await this.notifications.notify({
        businessId,
        userIds: claim.employees.map((e) => e.userId),
        type: 'ClaimStatusNotification',
        msg: `Your claim "${claim.description}" was ${label === 'UnApproved' ? 'marked UnApproved' : label.toLowerCase()}`,
        icon: newStatus === 'APPROVED' ? 'check' : newStatus === 'UNAPPROVED' ? 'x' : 'wallet',
        link: '/claims',
      });
    }

    return this.findOne(businessId, id);
  }

  async remove(businessId: number, id: number) {
    const claim = await this.prisma.claimReimbursement.findFirst({ where: { id, businessId } });
    if (!claim) throw new NotFoundException('Claim not found');
    await this.prisma.claimReimbursement.delete({ where: { id } });
    if (claim.document) await this.storage.remove(claim.document);
    return { success: true };
  }
}
