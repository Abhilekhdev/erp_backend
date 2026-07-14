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
  type: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.enum(['single', 'variable', 'combo']).optional(),
  ),
  active: z.preprocess((v) => (v === '' || v === undefined ? undefined : v === 'true' || v === true), z.boolean().optional()),
});

export class ProductsQueryDto extends createZodDto(productsQuerySchema) {}
