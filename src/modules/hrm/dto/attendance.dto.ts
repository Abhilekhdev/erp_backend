import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const nullableNum = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().int().positive().nullable().optional(),
);
const optId = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().int().positive().optional(),
);

export const createAttendanceSchema = z.object({
  userId: z.coerce.number({ invalid_type_error: 'Select an employee' }).int().positive('Select an employee'),
  shiftId: nullableNum,
  activityCodeId: nullableNum,
  clockInTime: z.string().min(1, 'Clock in time is required'),
  clockOutTime: z.string().optional(),
  clockInNote: z.string().optional(),
  clockOutNote: z.string().optional(),
  ipAddress: z.string().optional(),
});
export class CreateAttendanceDto extends createZodDto(createAttendanceSchema) {}
export class UpdateAttendanceDto extends createZodDto(createAttendanceSchema.partial()) {}

export const clockSchema = z.object({
  // Activity code is NOT chosen at clock-in — it defaults from the employee's assigned activity codes.
  note: z.string().optional(),
  location: z.string().optional(),
});
export class ClockDto extends createZodDto(clockSchema) {}

export const deleteSelectedSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).default([]),
});
export class DeleteSelectedDto extends createZodDto(deleteSelectedSchema) {}

// Bulk import — one object per attendance record (parsed from the uploaded CSV on the client).
export const importAttendanceSchema = z.object({
  rows: z
    .array(
      z.object({
        email: z.string().min(1),
        clockInTime: z.string().min(1),
        clockOutTime: z.string().optional(),
        activityCode: z.string().optional(),
        shift: z.string().optional(),
        clockInNote: z.string().optional(),
        clockOutNote: z.string().optional(),
        ipAddress: z.string().optional(),
      }),
    )
    .min(1, 'The file has no rows to import')
    .max(5000, 'Too many rows — import up to 5000 at a time'),
});
export class ImportAttendanceDto extends createZodDto(importAttendanceSchema) {}

export const attendanceQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional().default(''),
  employeeId: optId,
  activityCodeId: optId,
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
export class AttendanceQueryDto extends createZodDto(attendanceQuerySchema) {}
