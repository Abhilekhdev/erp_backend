import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const blankUndef = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const optId = z.preprocess(blankUndef, z.coerce.number().int().positive().optional());
const dateStr = z.preprocess(
  blankUndef,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').optional(),
);

/**
 * `employees` arrives from a multipart form, so it can be a single string, a repeated field
 * (array), or absent. Normalise to a list of positive ints. An empty list means "no explicit
 * assignment" — the service falls back to the current user (GOURI's non-approver behaviour).
 */
const employees = z.preprocess((v) => {
  if (v === '' || v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}, z.array(z.coerce.number().int().positive()).default([]));

// Create / edit a claim. Multipart: the optional document is handled by the controller, not here.
export const saveClaimSchema = z.object({
  description: z.preprocess(blankUndef, z.string().min(1, 'Description is required').max(255)),
  amount: z.coerce.number({ invalid_type_error: 'Amount is required' }).min(0, 'Amount must be 0 or more'),
  categoryId: optId,
  subCategoryId: optId,
  applicableDate: dateStr,
  employees,
  // Only honoured for approvers (enforced in the service); a normal user's claim stays Pending.
  status: z.preprocess(blankUndef, z.enum(['pending', 'approved', 'unapproved']).optional()),
});
export class SaveClaimDto extends createZodDto(saveClaimSchema) {}

export const changeClaimStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'unapproved']),
  statusNote: z.string().optional(),
});
export class ChangeClaimStatusDto extends createZodDto(changeClaimStatusSchema) {}

// Claim category master. `parentId` present ⇒ it's a sub-category.
export const saveClaimCategorySchema = z.object({
  name: z.preprocess(blankUndef, z.string().min(1, 'Category name is required').max(191)),
  code: z.preprocess(blankUndef, z.string().max(191).optional()),
  parentId: optId,
});
export class SaveClaimCategoryDto extends createZodDto(saveClaimCategorySchema) {}
