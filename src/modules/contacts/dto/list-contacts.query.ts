import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Query for the shared suppliers/customers list. `type` picks the tab; the money-based
 * filters (purchase/sell due, opening balance) are deferred until the transaction core
 * exists, so only status + customer-group filtering is active here.
 */
export const listContactsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(10),
  search: z.string().optional().default(''),
  type: z.enum(['supplier', 'customer']),
  status: z.enum(['active', 'inactive']).optional(),
  customerGroupId: z.coerce.number().int().positive().optional(),
});

export class ListContactsQueryDto extends createZodDto(listContactsSchema) {}
