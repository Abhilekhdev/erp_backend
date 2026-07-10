import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createShiftSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  type: z.enum(['fixed_shift', 'flexible_shift']).default('fixed_shift'),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  holidays: z.array(z.string()).optional().default([]),
  isAllowedAutoClockout: z.boolean().optional().default(false),
  autoClockoutTime: z.string().optional(),
});
export class CreateShiftDto extends createZodDto(createShiftSchema) {}
export class UpdateShiftDto extends createZodDto(createShiftSchema.partial()) {}

export const assignUsersSchema = z.object({
  assignments: z
    .array(
      z.object({
        userId: z.coerce.number().int().positive(),
        isAdded: z.boolean(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
    )
    .default([]),
});
export class AssignUsersDto extends createZodDto(assignUsersSchema) {}
