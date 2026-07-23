import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().optional());
const optStr = z.preprocess(blank, z.string().max(191).optional());

export const purchaseReturnsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  /** Matches the return's reference number, the parent purchase's, or the supplier. */
  search: z.string().optional().default(''),
  locationId: optId,
  contactId: optId,
  paymentStatus: z.preprocess(blank, z.enum(['paid', 'due', 'partial']).optional()),
  dateFrom: z.preprocess(blank, z.coerce.date().optional()),
  dateTo: z.preprocess(blank, z.coerce.date().optional()),
});

export class PurchaseReturnsQueryDto extends createZodDto(purchaseReturnsQuerySchema) {}

/**
 * One returned line, identified by the purchase line it came from.
 *
 * GOURI matches the parent line by `product_id` alone, so a variable product with several
 * variations on one purchase always returns against the first line — wrong price, wrong variation.
 * Here the parent LINE is the identifier, which is unambiguous by construction.
 */
export const purchaseReturnLineSchema = z.object({
  parent_line_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().min(0),
});

export const savePurchaseReturnSchema = z.object({
  /** The purchase being returned. A return always has a parent — GOURI's second, parentless flow
   *  is what makes its own list show a blank "parent purchase" column. */
  purchase_id: z.coerce.number().int().positive('Select the purchase being returned'),
  ref_no: optStr,
  transaction_date: z.string().min(1, 'Return date is required'),
  /** Charged on the returned subtotal, the same way a purchase's order tax is. */
  tax_rate_id: optId,
  additional_notes: z.preprocess(blank, z.string().optional()),
  returns: z.array(purchaseReturnLineSchema).min(1, 'Return at least one line'),
});

export type PurchaseReturnLineInput = z.infer<typeof purchaseReturnLineSchema>;
export class SavePurchaseReturnDto extends createZodDto(savePurchaseReturnSchema) {}

export const saveReturnPaymentSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  method: z.string().min(1).max(191),
  account_id: optId,
  paid_on: z.preprocess(blank, z.string().optional()),
  card_transaction_number: optStr,
  card_holder_name: optStr,
  card_type: optStr,
  cheque_number: optStr,
  bank_account_number: optStr,
  transaction_no: optStr,
  note: z.preprocess(blank, z.string().optional()),
});
export class SaveReturnPaymentDto extends createZodDto(saveReturnPaymentSchema) {}
