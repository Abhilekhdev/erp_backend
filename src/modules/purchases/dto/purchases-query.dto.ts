import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().optional());

export const purchasesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  /** Matches reference number or supplier name. */
  search: z.string().optional().default(''),
  locationId: optId,
  contactId: optId,
  status: z.preprocess(blank, z.enum(['received', 'pending', 'ordered']).optional()),
  /**
   * `overdue` is not a stored value — it means due/partial AND past the pay term, exactly as
   * GOURI computes it at read time.
   */
  paymentStatus: z.preprocess(blank, z.enum(['paid', 'due', 'partial', 'overdue']).optional()),
  dateFrom: z.preprocess(blank, z.coerce.date().optional()),
  dateTo: z.preprocess(blank, z.coerce.date().optional()),
});

export class PurchasesQueryDto extends createZodDto(purchasesQuerySchema) {}

export const savePaymentSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  method: z.string().min(1).max(191),
  account_id: z.preprocess(blank, z.coerce.number().int().positive().optional()),
  paid_on: z.preprocess(blank, z.string().optional()),
  card_transaction_number: z.preprocess(blank, z.string().max(191).optional()),
  card_holder_name: z.preprocess(blank, z.string().max(191).optional()),
  card_type: z.preprocess(blank, z.string().max(191).optional()),
  cheque_number: z.preprocess(blank, z.string().max(191).optional()),
  bank_account_number: z.preprocess(blank, z.string().max(191).optional()),
  transaction_no: z.preprocess(blank, z.string().max(191).optional()),
  note: z.preprocess(blank, z.string().optional()),
});

export class SavePaymentDto extends createZodDto(savePaymentSchema) {}

export const updateStatusSchema = z.object({
  status: z.enum(['received', 'pending', 'ordered']),
});
export class UpdateStatusDto extends createZodDto(updateStatusSchema) {}

export const updateApprovalSchema = z.object({
  is_approved: z.coerce.boolean(),
});
export class UpdateApprovalDto extends createZodDto(updateApprovalSchema) {}
