import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createAllowanceDeductionSchema = z.object({
  description: z.string().min(1, 'Description is required').max(191),
  type: z.enum(['allowance', 'deduction']).default('allowance'),
  amount: z.coerce.number().min(0, 'Amount cannot be negative'),
  amountType: z.enum(['fixed', 'percent']).default('fixed'),
  applicableDate: z.string().optional(),
  employees: z.array(z.coerce.number().int().positive()).optional().default([]),
});
export class CreateAllowanceDeductionDto extends createZodDto(createAllowanceDeductionSchema) {}
export class UpdateAllowanceDeductionDto extends createZodDto(createAllowanceDeductionSchema.partial()) {}
