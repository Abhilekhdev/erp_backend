import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().optional());

export const expensePaymentSchema = z.object({
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

/**
 * An expense (GOURI TransactionUtil::createExpense). The user enters `final_total`; when a tax is
 * chosen it is treated as TAX-INCLUSIVE, so total_before_tax = final_total / (1 + tax%/100).
 */
export const saveExpenseSchema = z.object({
  location_id: z.coerce.number({ invalid_type_error: 'Select a location' }).int().positive('Select a location'),
  transaction_date: z.string().min(1, 'Date is required'),
  ref_no: z.string().max(191).optional(),
  expense_category_id: optId,
  expense_sub_category_id: optId,
  expense_for: optId,
  contact_id: optId,
  tax_rate_id: optId,
  final_total: z.coerce.number().min(0, 'Amount cannot be negative'),
  additional_notes: z.string().optional(),
  is_refund: z.coerce.boolean().optional().default(false),
  is_recurring: z.coerce.boolean().optional().default(false),
  recur_interval: z.preprocess(blank, z.coerce.number().positive().optional()),
  recur_interval_type: z.preprocess(blank, z.enum(['days', 'months', 'years']).optional()),
  recur_repetitions: z.preprocess(blank, z.coerce.number().int().positive().optional()),
  document: z.string().max(500).optional(),
  payment: z.array(expensePaymentSchema).optional().default([]),
});

export class SaveExpenseDto extends createZodDto(saveExpenseSchema) {}
export class UpdateExpenseDto extends createZodDto(saveExpenseSchema.partial()) {}

export const expensesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  search: z.string().optional().default(''),
  locationId: optId,
  contactId: optId,
  expenseCategoryId: optId,
  expenseSubCategoryId: optId,
  expenseFor: optId,
  paymentStatus: z.preprocess(blank, z.enum(['paid', 'due', 'partial']).optional()),
  dateFrom: z.preprocess(blank, z.coerce.date().optional()),
  dateTo: z.preprocess(blank, z.coerce.date().optional()),
});
export class ExpensesQueryDto extends createZodDto(expensesQuerySchema) {}
