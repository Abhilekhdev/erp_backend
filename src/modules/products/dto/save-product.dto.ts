import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const boolish = z.preprocess((v) => v === true || v === 1 || v === '1' || v === 'true', z.boolean());
const optNum = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().optional(),
);
const optId = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().int().positive().optional(),
);

/** The 5 price fields shared by every variation, plus optional per-price-group overrides. */
const priceLine = z.object({
  default_purchase_price: optNum,
  dpp_inc_tax: optNum,
  profit_percent: optNum,
  default_sell_price: optNum,
  sell_price_inc_tax: optNum,
  group_prices: z
    .array(z.object({ price_group_id: z.coerce.number().int().positive(), price_inc_tax: z.coerce.number().min(0) }))
    .optional()
    .default([]),
});

/** One value row of a variable product (e.g. "Red"). */
const variableValue = priceLine.extend({
  value: z.string().min(1, 'Value name is required'),
  sub_sku: z.string().optional(),
  variation_value_id: optId,
});

/** One attribute of a variable product (e.g. "Colour" with its values). */
const variableAttribute = z.object({
  variation_template_id: optId,
  name: z.string().min(1, 'Variation name is required'),
  values: z.array(variableValue).min(1, 'Add at least one value'),
});

const comboItem = z.object({
  variation_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive(),
  unit_id: optId,
});

export const saveProductSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(255),
    type: z.enum(['single', 'variable', 'combo']).default('single'),
    unit_id: optId,
    secondary_unit_id: optId,
    sub_unit_ids: z.array(z.coerce.number().int().positive()).optional().default([]),
    brand_id: optId,
    category_id: optId,
    sub_category_id: optId,
    tax: optId, // tax_rate id
    tax_type: z.enum(['inclusive', 'exclusive']).default('exclusive'),
    enable_stock: boolish.optional().default(false),
    alert_quantity: optNum,
    sku: z.string().max(255).optional(),
    barcode_type: z.enum(['C128', 'C39', 'EAN13', 'EAN8', 'UPCA', 'UPCE']).default('C128'),
    expiry_period: optNum,
    expiry_period_type: z.enum(['days', 'months']).optional(),
    enable_sr_no: boolish.optional().default(false),
    weight: z.string().max(255).optional(),
    product_custom_field1: z.string().max(255).optional(),
    product_custom_field2: z.string().max(255).optional(),
    product_custom_field3: z.string().max(255).optional(),
    product_custom_field4: z.string().max(255).optional(),
    product_description: z.string().optional(),
    warranty_id: optId,
    not_for_selling: boolish.optional().default(false),
    // type-specific payloads
    single: priceLine.optional(),
    variations: z.array(variableAttribute).optional(),
    combo: priceLine.extend({ composition: z.array(comboItem).min(1, 'Add at least one combo item') }).optional(),
  })
  .refine((d) => d.type !== 'single' || d.single, { message: 'Single product price is required', path: ['single'] })
  .refine((d) => d.type !== 'variable' || (d.variations && d.variations.length > 0), {
    message: 'Add at least one variation',
    path: ['variations'],
  })
  .refine((d) => d.type !== 'combo' || d.combo, { message: 'Combo composition is required', path: ['combo'] });

export class SaveProductDto extends createZodDto(saveProductSchema) {}
