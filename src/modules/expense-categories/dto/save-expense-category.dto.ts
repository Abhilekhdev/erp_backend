import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const nullableNumber = (inner: z.ZodTypeAny = z.coerce.number()) =>
  z.preprocess((v) => (v === '' || v === undefined ? undefined : v), inner.nullable().optional());

/** Expense category / sub-category (legacy ExpenseCategoryController). `parent_id` set = sub-category. */
export const saveExpenseCategorySchema = z.object({
  name: z.string().min(1, 'Name is required').max(191),
  code: z.string().max(191).optional(),
  parent_id: nullableNumber(z.coerce.number().int().positive()),
});

export class SaveExpenseCategoryDto extends createZodDto(saveExpenseCategorySchema) {}
