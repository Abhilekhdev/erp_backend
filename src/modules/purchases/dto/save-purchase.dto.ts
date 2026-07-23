import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().optional());
const money = z.preprocess(blank, z.coerce.number().min(0).optional().default(0));
const optStr = z.preprocess(blank, z.string().max(191).optional());

/**
 * One received line. Only the quantity and the prices the user actually typed are accepted —
 * every derived figure (line tax, price incl. tax, line total, and the whole document total) is
 * recomputed server-side. GOURI trusts the browser's `final_total` verbatim on store, update AND
 * purchase-return, so a crafted request can book any total it likes.
 */
export const purchaseLineSchema = z.object({
  /** Set when editing an existing line; absent means a new line. */
  purchase_line_id: optId,
  /** The purchase-order line this receives against, when the purchase was raised from one. */
  purchase_order_line_id: optId,
  product_id: z.coerce.number().int().positive(),
  variation_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  /** The unit the user typed in, when it isn't the product's base unit. */
  sub_unit_id: optId,
  secondary_unit_quantity: money,
  /** List price before the line discount. */
  pp_without_discount: money,
  discount_percent: z.preprocess(blank, z.coerce.number().min(0).max(100).optional().default(0)),
  tax_rate_id: optId,
  lot_number: optStr,
  mfg_date: optStr,
  exp_date: optStr,
  /** Optional: update the product's selling price from the purchase screen. */
  default_sell_price: z.preprocess(blank, z.coerce.number().min(0).optional()),
});

/** A payment taken at the time of purchase. */
export const purchasePaymentSchema = z.object({
  payment_id: optId,
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

export const savePurchaseSchema = z.object({
  contact_id: z.coerce.number().int().positive('Select a supplier'),
  location_id: z.coerce.number().int().positive('Select a business location'),
  /** Blank auto-generates `{prefix}{YYYY}/{0000}`. */
  ref_no: optStr,
  transaction_date: z.string().min(1, 'Purchase date is required'),
  status: z.enum(['received', 'pending', 'ordered']).default('received'),
  /** Only a user with `purchase.approve` may send false; see the service. */
  is_approved: z.preprocess(blank, z.coerce.boolean().optional()),

  pay_term_number: z.preprocess(blank, z.coerce.number().int().min(0).optional()),
  pay_term_type: z.preprocess(blank, z.enum(['days', 'months']).optional()),

  discount_type: z.preprocess(blank, z.enum(['fixed', 'percentage']).optional()),
  discount_amount: money,
  tax_rate_id: optId,
  shipping_details: optStr,
  shipping_charges: money,
  /** Landed costs beyond shipping. GOURI caps these at four numbered column pairs. */
  additional_expenses: z
    .array(z.object({ name: z.string().max(191), amount: z.coerce.number().min(0) }))
    .optional(),

  /** Amounts are entered in this currency and stored converted to the base currency. */
  exchange_rate: z.preprocess(blank, z.coerce.number().positive().optional().default(1)),

  additional_notes: z.preprocess(blank, z.string().optional()),
  document: optStr,
  custom_field_1: optStr,
  custom_field_2: optStr,
  custom_field_3: optStr,
  custom_field_4: optStr,

  /** Purchase orders this receipt draws down. */
  purchase_order_ids: z.array(z.coerce.number().int().positive()).optional(),
  purchases: z.array(purchaseLineSchema).min(1, 'Add at least one product'),
  /** Payments are accepted on create; edits leave existing payments alone (GOURI parity). */
  payment: z.array(purchasePaymentSchema).optional(),
});

export type PurchaseLineInput = z.infer<typeof purchaseLineSchema>;
export type PurchasePaymentInput = z.infer<typeof purchasePaymentSchema>;
export class SavePurchaseDto extends createZodDto(savePurchaseSchema) {}
