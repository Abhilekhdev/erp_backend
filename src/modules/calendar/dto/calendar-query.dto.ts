import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Calendar events query — mirrors what GOURI's FullCalendar sends to `/calendar`
 * (`start`, `end`, `events[]`, `user_id`, `location_id`).
 */
export const calendarQuerySchema = z.object({
  /** Window start (inclusive), YYYY-MM-DD. */
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start must be YYYY-MM-DD'),
  /** Window end (inclusive), YYYY-MM-DD. */
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'end must be YYYY-MM-DD'),
  /** Which event types to include. Omitted = all available types (FullCalendar sends `events[]`). */
  events: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v == null ? undefined : Array.isArray(v) ? v : [v])),
  userId: z.coerce.number().int().positive().optional(),
  locationId: z.coerce.number().int().positive().optional(),
});

export class CalendarQueryDto extends createZodDto(calendarQuerySchema) {}
