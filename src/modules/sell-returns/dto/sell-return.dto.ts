import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().optional());
const optStr = z.preprocess(blank, z.string().max(191).optional());

export const sellReturnsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  search: z.string().optional().default(''),
  locationId: optId,
  contactId: optId,
  paymentStatus: z.preprocess(blank, z.enum(['paid', 'due', 'partial']).optional()),
  dateFrom: z.preprocess(blank, z.coerce.date().optional()),
  dateTo: z.preprocess(blank, z.coerce.date().optional()),
});
export class SellReturnsQueryDto extends createZodDto(sellReturnsQuerySchema) {}

export const sellReturnLineSchema = z.object({
  parent_line_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().min(0),
});

export const saveSellReturnSchema = z.object({
  sell_id: z.coerce.number().int().positive('Select the sale being returned'),
  ref_no: optStr,
  transaction_date: z.string().min(1, 'Return date is required'),
  tax_rate_id: optId,
  discount_type: z.preprocess(blank, z.enum(['fixed', 'percentage']).optional()),
  discount_amount: z.preprocess(blank, z.coerce.number().min(0).optional().default(0)),
  additional_notes: z.preprocess(blank, z.string().optional()),
  returns: z.array(sellReturnLineSchema).min(1, 'Return at least one line'),
});
export type SellReturnLineInput = z.infer<typeof sellReturnLineSchema>;
export class SaveSellReturnDto extends createZodDto(saveSellReturnSchema) {}

export const saveRefundSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  method: z.string().min(1).max(191),
  account_id: optId,
  paid_on: optStr,
  cheque_number: optStr,
  bank_account_number: optStr,
  transaction_no: optStr,
  note: z.preprocess(blank, z.string().optional()),
});
export class SaveRefundDto extends createZodDto(saveRefundSchema) {}
