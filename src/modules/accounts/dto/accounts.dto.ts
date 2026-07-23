import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** account_details — up to 6 { label, value } rows (GOURI stores as a JSON array). */
const accountDetailRow = z.object({
  label: z.string().max(191).optional().default(''),
  value: z.string().max(191).optional().default(''),
});

export const saveAccountSchema = z.object({
  name: z.string().min(1, 'Account name is required').max(191),
  accountNumber: z.string().min(1, 'Account number is required').max(191),
  accountTypeId: z.coerce.number().int().nullish(),
  openingBalance: z.coerce.number().optional(), // create-only: seeds a credit row
  accountDetails: z.array(accountDetailRow).max(6).optional(),
  note: z.string().max(2000).nullish(),
});
export class SaveAccountDto extends createZodDto(saveAccountSchema) {}

export const saveAccountTypeSchema = z.object({
  name: z.string().min(1, 'Name is required').max(191),
  parentAccountTypeId: z.coerce.number().int().nullish(),
});
export class SaveAccountTypeDto extends createZodDto(saveAccountTypeSchema) {}

export const fundTransferSchema = z.object({
  fromAccountId: z.coerce.number().int(),
  toAccountId: z.coerce.number().int(),
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  operationDate: z.coerce.date().optional(),
  note: z.string().max(2000).nullish(),
});
export class FundTransferDto extends createZodDto(fundTransferSchema) {}

export const depositSchema = z.object({
  toAccountId: z.coerce.number().int(),
  fromAccountId: z.coerce.number().int().nullish(), // optional funding account
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  operationDate: z.coerce.date().optional(),
  note: z.string().max(2000).nullish(),
});
export class DepositDto extends createZodDto(depositSchema) {}

export const updateAccountTransactionSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  operationDate: z.coerce.date().optional(),
  note: z.string().max(2000).nullish(),
});
export class UpdateAccountTransactionDto extends createZodDto(updateAccountTransactionSchema) {}
