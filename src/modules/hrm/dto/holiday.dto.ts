import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');

export const createHolidaySchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  startDate: dateStr,
  endDate: dateStr,
  locationId: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.coerce.number().int().positive().nullable().optional(),
  ),
  note: z.string().optional(),
});
export class CreateHolidayDto extends createZodDto(createHolidaySchema) {}
export class UpdateHolidayDto extends createZodDto(createHolidaySchema.partial()) {}

export const holidaysQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional().default(''),
  locationId: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.coerce.number().int().positive().optional(),
  ),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
export class HolidaysQueryDto extends createZodDto(holidaysQuerySchema) {}
