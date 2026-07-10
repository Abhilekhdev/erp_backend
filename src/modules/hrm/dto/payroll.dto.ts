import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const optId = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().int().positive().optional(),
);
const nullableId = z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : v),
  z.coerce.number().int().positive().nullable().optional(),
);
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Pick a month (YYYY-MM)');

const lineSchema = z.object({
  type: z.enum(['allowance', 'deduction']),
  description: z.string().min(1),
  amountType: z.enum(['fixed', 'percent']),
  amount: z.coerce.number().min(0),
});

export const preparePayrollSchema = z.object({
  month,
  employeeIds: z.array(z.coerce.number().int().positive()).min(1, 'Select at least one employee'),
});
export class PreparePayrollDto extends createZodDto(preparePayrollSchema) {}

export const generatePayrollSchema = z.object({
  name: z.string().min(1, 'Group name is required').max(255),
  status: z.enum(['draft', 'final']).default('final'),
  locationId: nullableId,
  month,
  notify: z.boolean().optional().default(false),
  employees: z
    .array(
      z.object({
        userId: z.coerce.number().int().positive(),
        basicSalary: z.coerce.number().min(0),
        lines: z.array(lineSchema).default([]),
      }),
    )
    .min(1, 'Select at least one employee'),
});
export class GeneratePayrollDto extends createZodDto(generatePayrollSchema) {}

export const payrollQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional().default(''),
  employeeId: optId,
  departmentId: optId,
  designationId: optId,
  locationId: optId,
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});
export class PayrollQueryDto extends createZodDto(payrollQuerySchema) {}
