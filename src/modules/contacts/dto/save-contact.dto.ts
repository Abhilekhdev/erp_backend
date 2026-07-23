import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const str = z.string().max(255).nullish();
const optionalEmail = z.union([z.string().email('Invalid email'), z.literal('')]).nullish();

/**
 * Create/Update payload for a Contact — mirrors the fields collected by GOURI_DEV
 * ContactController@store/@update (`$request->only([...])` + credit_limit/is_export/export_*).
 * `opening_balance` is stored as a `transactions` row (`type=opening_balance`), never on the
 * contact — GOURI's model. On edit it is the REMAINING amount (gross minus anything paid).
 */
export const saveContactSchema = z
  .object({
    type: z.enum(['supplier', 'customer', 'both']),
    contact_type_radio: z.enum(['individual', 'business']).default('individual'),

    supplier_business_name: str,
    prefix: str,
    first_name: str,
    middle_name: str,
    last_name: str,
    contact_id: str,
    email: optionalEmail,

    tax_number: str,
    customer_group_id: z.coerce.number().int().positive().nullish(),
    pay_term_number: z.coerce.number().int().min(0).nullish(),
    pay_term_type: z.enum(['days', 'months']).nullish(),
    credit_limit: z.coerce.number().min(0).nullish(),

    mobile: z.string().min(1, 'Mobile is required').max(255),
    landline: str,
    alternate_number: str,

    address_line_1: z.string().nullish(),
    address_line_2: z.string().nullish(),
    city: str,
    state: str,
    country: str,
    zip_code: str,
    dob: z.string().nullish(),

    custom_field1: str,
    custom_field2: str,
    custom_field3: str,
    custom_field4: str,
    custom_field5: str,
    custom_field6: str,
    custom_field7: str,
    custom_field8: str,
    custom_field9: str,
    custom_field10: str,

    shipping_address: z.string().nullish(),
    position: str,
    shipping_custom_field_details: z.record(z.string(), z.any()).nullish(),

    is_export: z.coerce.boolean().optional().default(false),
    export_custom_field_1: str,
    export_custom_field_2: str,
    export_custom_field_3: str,
    export_custom_field_4: str,
    export_custom_field_5: str,
    export_custom_field_6: str,

    assigned_to_users: z.array(z.coerce.number().int().positive()).optional(),

    // Deferred (accepted, not persisted): opening balance becomes a transactions row later.
    opening_balance: z.coerce.number().nullish(),
  })
  // Individual contacts require a first name (business contacts use the business name).
  .refine((d) => d.contact_type_radio !== 'individual' || !!(d.first_name && d.first_name.trim()), {
    message: 'First name is required',
    path: ['first_name'],
  });

export type SaveContactInput = z.infer<typeof saveContactSchema>;

export class SaveContactDto extends createZodDto(saveContactSchema) {}
