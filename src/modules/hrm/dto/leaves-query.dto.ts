import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const optId = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().int().positive().optional(),
);

export const leavesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional().default(''),
  userId: optId,
  leaveTypeId: optId,
  status: z.enum(['pending', 'approved', 'cancelled']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
export class LeavesQueryDto extends createZodDto(leavesQuerySchema) {}
