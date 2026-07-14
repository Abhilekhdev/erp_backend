import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** GOURI_DEV VariationTemplateController@store/@update — an attribute name + its allowed values. */
export const saveVariationTemplateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  values: z
    .array(z.string().trim().min(1))
    .min(1, 'Add at least one value')
    .transform((arr) => arr.map((v) => v.trim()).filter(Boolean)),
});

export class SaveVariationTemplateDto extends createZodDto(saveVariationTemplateSchema) {}
