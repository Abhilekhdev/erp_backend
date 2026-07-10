import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Create/Update payload for an Invoice Scheme — mirrors the fields collected by
 * GOURI_DEV InvoiceSchemeController@store/@update (`$request->only([...])`) + the `is_default` flag.
 */
export const saveInvoiceSchemeSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  scheme_type: z.enum(['blank', 'year']).default('blank'),
  prefix: z.string().max(255).nullish(),
  start_number: z.coerce.number().int().min(0).nullish(),
  total_digits: z.coerce.number().int().min(4).max(10).nullish(),
  is_default: z.coerce.boolean().optional().default(false),
});

export type SaveInvoiceSchemeInput = z.infer<typeof saveInvoiceSchemeSchema>;

export class SaveInvoiceSchemeDto extends createZodDto(saveInvoiceSchemeSchema) {}
