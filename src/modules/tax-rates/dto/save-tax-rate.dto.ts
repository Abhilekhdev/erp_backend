import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const boolish = z.preprocess(
  (v) => v === true || v === 1 || v === '1' || v === 'true',
  z.boolean(),
);

/** Simple tax rate — GOURI_DEV TaxRateController@store/@update (name, amount, for_tax_group). */
export const saveTaxRateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  amount: z.coerce.number().min(0, 'Rate cannot be negative').max(100, 'Rate cannot exceed 100'),
  for_tax_group: boolish.optional().default(false),
});
export class SaveTaxRateDto extends createZodDto(saveTaxRateSchema) {}

/** Tax group — GOURI_DEV GroupTaxController@store/@update (name + member simple-rate ids). */
export const saveTaxGroupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  taxes: z.array(z.coerce.number().int().positive()).min(1, 'Select at least one tax rate'),
});
export class SaveTaxGroupDto extends createZodDto(saveTaxGroupSchema) {}
