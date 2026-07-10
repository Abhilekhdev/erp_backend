import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Create/Update payload for a Business Location — mirrors the fields collected by
 * GOURI_DEV `BusinessLocationController@store/@update` (`$request->only([...])`).
 *
 * Required in GOURI's form: name, city, state, country, zip_code, invoice_scheme_id,
 * invoice_layout_id, sale_invoice_layout_id. The three invoice/layout selects depend on the
 * Invoice Schemes / Invoice Layouts modules which aren't built yet, so they are accepted as
 * optional here (service defaults the two NOT-NULL columns to 0 when absent) — same graceful
 * stance business-settings takes for its taxRates/units lists.
 */
const paymentAccountSchema = z.object({
  is_enabled: z.coerce.boolean().optional().default(false),
  account: z.coerce.number().int().nullish(),
});

export const saveBusinessLocationSchema = z.object({
  name: z.string().min(1, 'Name is required').max(256),
  location_id: z.string().max(255).nullish(),
  landmark: z.string().nullish(),
  city: z.string().min(1, 'City is required').max(100),
  state: z.string().min(1, 'State is required').max(100),
  country: z.string().min(1, 'Country is required').max(100),
  zip_code: z.string().min(1, 'Zip code is required').max(7),
  mobile: z.string().max(255).nullish(),
  alternate_number: z.string().max(255).nullish(),
  email: z.string().email('Enter a valid email').max(255).nullish().or(z.literal('')),
  website: z.string().max(255).nullish(),

  invoice_scheme_id: z.coerce.number().int().nullish(),
  invoice_layout_id: z.coerce.number().int().nullish(),
  sale_invoice_layout_id: z.coerce.number().int().nullish(),
  selling_price_group_id: z.coerce.number().int().nullish(),

  custom_field1: z.string().max(255).nullish(),
  custom_field2: z.string().max(255).nullish(),
  custom_field3: z.string().max(255).nullish(),
  custom_field4: z.string().max(255).nullish(),

  // { [payment_type_key]: { is_enabled, account } } — stored verbatim as JSON like Laravel.
  default_payment_accounts: z.record(z.string(), paymentAccountSchema).nullish(),
  // Variation ids for the POS "featured products" (Products module — stored as-is).
  featured_products: z.array(z.coerce.number().int()).nullish(),
});

export type SaveBusinessLocationInput = z.infer<typeof saveBusinessLocationSchema>;

export class SaveBusinessLocationDto extends createZodDto(saveBusinessLocationSchema) {}
