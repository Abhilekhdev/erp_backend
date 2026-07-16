import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Empty query-string params arrive as '' — treat them as "no filter", not as a bad value. */
const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().optional());
const optStr = z.preprocess(blank, z.string().optional());

export const leavesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional().default(''),
  userId: optId,
  leaveTypeId: optId,
  status: z.preprocess(blank, z.enum(['pending', 'approved', 'cancelled']).optional()),
  startDate: optStr,
  endDate: optStr,
});
export class LeavesQueryDto extends createZodDto(leavesQuerySchema) {}
