import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const optInt = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().int().min(0, 'Cannot be negative').optional(),
);

export const createLeaveTypeSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  maxLeaveCount: optInt,
  leaveCountInterval: z.preprocess(
    (v) => (v === '' ? null : v),
    z.enum(['month', 'year']).nullable().optional(),
  ),
  isPaid: z.boolean().optional().default(true),
});

export class CreateLeaveTypeDto extends createZodDto(createLeaveTypeSchema) {}
export class UpdateLeaveTypeDto extends createZodDto(createLeaveTypeSchema.partial()) {}
