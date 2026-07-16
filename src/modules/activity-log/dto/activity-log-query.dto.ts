import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Empty query-string params arrive as '' — treat them as "no filter", not as a bad value. */
const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().optional());
const optStr = z.preprocess(blank, z.string().optional());
const optDate = z.preprocess(blank, z.coerce.date().optional());

export const activityLogQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  /** Activity BY this user (the causer). */
  userId: optId,
  /** Activity ON this record — both together, e.g. subjectType=User&subjectId=11. */
  subjectType: optStr,
  subjectId: optId,
  action: optStr,
  dateFrom: optDate,
  dateTo: optDate,
});

export class ActivityLogQueryDto extends createZodDto(activityLogQuerySchema) {}
