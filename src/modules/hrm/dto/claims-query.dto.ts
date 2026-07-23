import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Empty query-string params arrive as '' — treat them as "no filter", not as a bad value. */
const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().optional());

export const claimsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional().default(''),
  userId: optId,
  categoryId: optId,
  status: z.preprocess(blank, z.enum(['pending', 'approved', 'unapproved']).optional()),
});
export class ClaimsQueryDto extends createZodDto(claimsQuerySchema) {}

export const claimCategoriesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional().default(''),
});
export class ClaimCategoriesQueryDto extends createZodDto(claimCategoriesQuerySchema) {}
