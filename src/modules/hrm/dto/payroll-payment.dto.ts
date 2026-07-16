import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Add-payment payload for a payroll — mirrors the per-employee `payments[<employee_id>]` block in
 * GOURI PayrollController@postAddPayment (method + card/cheque/bank fields + paid_on + account_id).
 * GOURI records these as `transaction_payments` rows; we store them in `payroll_payments`.
 */
export const payrollPaymentSchema = z.object({
  payroll_id: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  method: z.string().min(1, 'Payment method is required').max(50),
  paid_on: z.coerce.date(),
  account_id: z.coerce.number().int().nullish(),
  transaction_no: z.string().max(255).nullish(),
  card_number: z.string().max(255).nullish(),
  card_holder_name: z.string().max(255).nullish(),
  card_transaction_number: z.string().max(255).nullish(),
  card_type: z.string().max(50).nullish(),
  card_month: z.string().max(255).nullish(),
  card_year: z.string().max(255).nullish(),
  card_security: z.string().max(5).nullish(),
  cheque_number: z.string().max(255).nullish(),
  bank_account_number: z.string().max(255).nullish(),
  note: z.string().nullish(),
});

/** Bulk form: GOURI's pay-group screen posts one payment row per employee in the group. */
export const addPayrollPaymentsSchema = z.object({
  payments: z.array(payrollPaymentSchema).min(1),
});

export type PayrollPaymentInput = z.infer<typeof payrollPaymentSchema>;

export class AddPayrollPaymentsDto extends createZodDto(addPayrollPaymentsSchema) {}
