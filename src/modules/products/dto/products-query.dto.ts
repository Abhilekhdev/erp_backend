import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const optId = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().int().positive().optional(),
);

export const productsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional().default(''),
  categoryId: optId,
  brandId: optId,
  unitId: optId,
  taxId: optId,
  /**
   * A location id, or the literal `none` — GOURI prepends a "None" option so you can find products
   * that were never assigned to any location (`ProductController.php:321`).
   */
  locationId: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.union([z.literal('none'), z.coerce.number().int().positive()]).optional(),
  ),
  notForSelling: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v === 'true' || v === true),
    z.boolean().optional(),
  ),
  type: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.enum(['single', 'variable', 'combo']).optional(),
  ),
  active: z.preprocess((v) => (v === '' || v === undefined ? undefined : v === 'true' || v === true), z.boolean().optional()),
});

export class ProductsQueryDto extends createZodDto(productsQuerySchema) {}
