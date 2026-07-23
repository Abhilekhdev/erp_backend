import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().optional());
const money = z.preprocess(blank, z.coerce.number().min(0).optional().default(0));
const optStr = z.preprocess(blank, z.string().max(191).optional());

export const sellsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  /** Matches invoice number or customer name. */
  search: z.string().optional().default(''),
  locationId: optId,
  contactId: optId,
  status: z.preprocess(blank, z.enum(['final', 'draft', 'quotation']).optional()),
  paymentStatus: z.preprocess(blank, z.enum(['paid', 'due', 'partial', 'overdue']).optional()),
  dateFrom: z.preprocess(blank, z.coerce.date().optional()),
  dateTo: z.preprocess(blank, z.coerce.date().optional()),
});
export class SellsQueryDto extends createZodDto(sellsQuerySchema) {}

/**
 * One sold line. The server recomputes every derived figure (line tax, inc-tax price, line total,
 * the whole document total) from the quantity, the EX-TAX unit price, and the tax rate — GOURI
 * trusts the browser's `unit_price_inc_tax`, `item_tax` and `final_total` instead.
 */
export const sellLineSchema = z.object({
  /** Set when editing an existing line. */
  sell_line_id: optId,
  /** The sales-order line this invoices, when the sell was raised from one. */
  so_line_id: optId,
  product_id: z.coerce.number().int().positive(),
  variation_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  sub_unit_id: optId,
  /** Ex-tax selling price. Defaults to the variation's default sell price if omitted. */
  unit_price: z.preprocess(blank, z.coerce.number().min(0).optional()),
  line_discount_type: z.preprocess(blank, z.enum(['fixed', 'percentage']).optional()),
  line_discount_amount: money,
  tax_rate_id: optId,
  note: z.preprocess(blank, z.string().optional()),
});

export const sellPaymentSchema = z.object({
  amount: z.coerce.number().min(0),
  method: z.string().min(1).max(191),
  account_id: optId,
  paid_on: optStr,
  card_transaction_number: optStr,
  card_holder_name: optStr,
  card_type: optStr,
  cheque_number: optStr,
  bank_account_number: optStr,
  transaction_no: optStr,
  note: z.preprocess(blank, z.string().optional()),
});

export const saveSellSchema = z.object({
  contact_id: z.coerce.number().int().positive('Select a customer'),
  location_id: z.coerce.number().int().positive('Select a business location'),
  /** Blank auto-generates the invoice number. */
  ref_no: optStr,
  transaction_date: z.string().min(1, 'Sale date is required'),
  status: z.enum(['final', 'draft']).default('final'),
  /** Only meaningful with status = draft. */
  sub_status: z.preprocess(blank, z.enum(['quotation', 'proforma']).optional()),

  pay_term_number: z.preprocess(blank, z.coerce.number().int().min(0).optional()),
  pay_term_type: z.preprocess(blank, z.enum(['days', 'months']).optional()),

  discount_type: z.preprocess(blank, z.enum(['fixed', 'percentage']).optional()),
  discount_amount: money,
  tax_rate_id: optId,

  shipping_details: optStr,
  shipping_address: z.preprocess(blank, z.string().optional()),
  shipping_charges: money,
  shipping_status: z.preprocess(blank, z.enum(['ordered', 'packed', 'shipped', 'delivered', 'cancelled']).optional()),
  delivered_to: optStr,
  additional_expenses: z
    .array(z.object({ name: z.string().max(191), amount: z.coerce.number().min(0) }))
    .optional(),
  round_off_amount: z.preprocess(blank, z.coerce.number().optional().default(0)),

  additional_notes: z.preprocess(blank, z.string().optional()),
  custom_field_1: optStr,
  custom_field_2: optStr,
  custom_field_3: optStr,
  custom_field_4: optStr,

  /** Sales orders this sell draws down. */
  sales_order_ids: z.array(z.coerce.number().int().positive()).optional(),
  sells: z.array(sellLineSchema).min(1, 'Add at least one product'),
  /** Payments taken at sale time; edits leave existing payments alone (GOURI parity). */
  payment: z.array(sellPaymentSchema).optional(),
});

export type SellLineInput = z.infer<typeof sellLineSchema>;
export class SaveSellDto extends createZodDto(saveSellSchema) {}

export const savePaymentSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  method: z.string().min(1).max(191),
  account_id: optId,
  paid_on: optStr,
  card_transaction_number: optStr,
  card_holder_name: optStr,
  card_type: optStr,
  cheque_number: optStr,
  bank_account_number: optStr,
  transaction_no: optStr,
  note: z.preprocess(blank, z.string().optional()),
});
export class SavePaymentDto extends createZodDto(savePaymentSchema) {}

export const updateSellStatusSchema = z.object({
  status: z.enum(['final', 'draft']),
});
export class UpdateSellStatusDto extends createZodDto(updateSellStatusSchema) {}
