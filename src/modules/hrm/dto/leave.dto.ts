import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');

// Apply for leave. `userId` is honoured only for admins filing on behalf of an employee.
export const createLeaveSchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  leaveTypeId: z.coerce.number({ invalid_type_error: 'Select a leave type' }).int().positive('Select a leave type'),
  startDate: dateStr,
  endDate: dateStr,
  reason: z.string().optional(),
});
export class CreateLeaveDto extends createZodDto(createLeaveSchema) {}

export const changeLeaveStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'cancelled']),
  statusNote: z.string().optional(),
});
export class ChangeLeaveStatusDto extends createZodDto(changeLeaveStatusSchema) {}

// Set a user's leave entitlements: one balance per leave type. Rows with an empty balance are dropped.
export const setLeaveBalancesSchema = z.object({
  balances: z
    .array(
      z.object({
        leaveTypeId: z.coerce.number().int().positive(),
        balance: z.preprocess(
          (v) => (v === '' || v === null || v === undefined ? undefined : v),
          z.coerce.number().min(0),
        ),
      }),
    )
    .default([]),
});
export class SetLeaveBalancesDto extends createZodDto(setLeaveBalancesSchema) {}
