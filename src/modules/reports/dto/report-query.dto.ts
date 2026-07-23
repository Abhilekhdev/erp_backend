import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Shared filter set for the report screens — the union of every filter GOURI's ReportController
 * accepts (location, date range, category/brand/unit, contact, user, …). Each report reads only the
 * fields it needs; the rest are ignored, so one DTO covers the whole module.
 */
export const reportQuerySchema = z.object({
  /** Inclusive window start, YYYY-MM-DD. Omitted = no lower bound. */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Inclusive window end, YYYY-MM-DD. Omitted = no upper bound. */
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  locationId: z.coerce.number().int().positive().optional(),

  categoryId: z.coerce.number().int().positive().optional(),
  brandId: z.coerce.number().int().positive().optional(),
  unitId: z.coerce.number().int().positive().optional(),

  contactId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),

  /** Customer & Supplier report — which side to list. */
  contactType: z.enum(['supplier', 'customer']).optional(),

  /** Trending Products — top-N. */
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
});

export class ReportQueryDto extends createZodDto(reportQuerySchema) {}
