import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Per-(business, ref_type) sequential reference codes — 1:1 with GOURI_DEV
 * `Util::setAndGetReferenceCount()` + `Util::generateReferenceNumber()`.
 *
 * Format rules (from generateReferenceNumber):
 *  - prefix comes from `business.ref_no_prefixes[<refType>]` (or an explicit default)
 *  - `contacts` | `business_location` | `username` → `prefix + 4-digit count`
 *  - everything else                              → `prefix + YEAR + '/' + 4-digit count`
 */
const NO_YEAR_TYPES = ['contacts', 'business_location', 'username'];

@Injectable()
export class ReferenceNumberService {
  constructor(private readonly prisma: PrismaService) {}

  /** Increment (or create at 1) the counter and return the new value. */
  async nextCount(businessId: number, refType: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.referenceCount.findFirst({ where: { businessId, refType } });
      if (existing) {
        const updated = await tx.referenceCount.update({
          where: { id: existing.id },
          data: { refCount: existing.refCount + 1 },
        });
        return updated.refCount;
      }
      const created = await tx.referenceCount.create({
        data: { businessId, refType, refCount: 1 },
      });
      return created.refCount;
    });
  }

  /** Format a count into the reference code for `refType`. */
  async format(
    businessId: number,
    refType: string,
    count: number,
    defaultPrefix?: string,
  ): Promise<string> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { refNoPrefixes: true },
    });
    const prefixes = (business?.refNoPrefixes ?? {}) as Record<string, string>;
    const prefix = defaultPrefix ?? prefixes[refType] ?? '';
    const digits = String(count).padStart(4, '0');

    if (NO_YEAR_TYPES.includes(refType)) return `${prefix}${digits}`;
    return `${prefix}${new Date().getFullYear()}/${digits}`;
  }

  /** Convenience: bump the counter and return the formatted code. */
  async generate(businessId: number, refType: string, defaultPrefix?: string): Promise<string> {
    const count = await this.nextCount(businessId, refType);
    return this.format(businessId, refType, count, defaultPrefix);
  }
}
