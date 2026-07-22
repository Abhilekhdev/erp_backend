import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().optional());

/**
 * The Stock Report shares the products list's filter bar, so it accepts the same params.
 *
 * Two GOURI bugs are fixed by construction: its tab never SENDS the tax filter even though the
 * shared UI shows it, and it forwards `location_id='none'` (an All-Products-only option) straight
 * into `where vld.location_id = 'none'`.
 */
export const stockReportQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  search: z.string().optional().default(''),
  categoryId: optId,
  brandId: optId,
  unitId: optId,
  taxId: optId,
  locationId: optId,
  active: z.preprocess((v) => (v === '' || v === undefined ? undefined : v === 'true' || v === true), z.boolean().optional()),
  notForSelling: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v === 'true' || v === true),
    z.boolean().optional(),
  ),
  /** Show only rows at or below the product's alert quantity. */
  lowStock: z.preprocess((v) => (v === '' || v === undefined ? undefined : v === 'true' || v === true), z.boolean().optional()),
});

export class StockReportQueryDto extends createZodDto(stockReportQuerySchema) {}
