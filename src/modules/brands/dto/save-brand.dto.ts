import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const boolish = z.preprocess(
  (v) => v === true || v === 1 || v === '1' || v === 'true',
  z.boolean(),
);

/**
 * Create/Update payload for a Brand — mirrors GOURI_DEV BrandController@store/@update
 * (name, description; use_for_repair only when the Repair module is installed).
 */
export const saveBrandSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().nullish(),
  use_for_repair: boolish.optional().default(false),
});

export type SaveBrandInput = z.infer<typeof saveBrandSchema>;

export class SaveBrandDto extends createZodDto(saveBrandSchema) {}
