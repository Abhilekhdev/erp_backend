import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const boolish = z.preprocess(
  (v) => v === true || v === 1 || v === '1' || v === 'true',
  z.boolean(),
);
const optId = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().int().positive().optional(),
);

/**
 * Create/Update payload for a product Category — mirrors GOURI_DEV TaxonomyController@store/@update
 * with type=product. A category becomes a SUB-CATEGORY only when `add_as_sub_category` is set AND a
 * `parent_id` is supplied (GOURI's `add_as_sub_cat`).
 */
export const saveCategorySchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  short_code: z.string().max(255).nullish(),
  description: z.string().nullish(),
  add_as_sub_category: boolish.default(false),
  parent_id: optId,
});

export type SaveCategoryInput = z.infer<typeof saveCategorySchema>;

export class SaveCategoryDto extends createZodDto(saveCategorySchema) {}
