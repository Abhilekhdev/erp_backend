import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const money = z.preprocess((v) => (v === '' || v === null || v === undefined ? 0 : v), z.coerce.number().min(0));

export const saveSalesTargetsSchema = z.object({
  bands: z
    .array(
      z.object({
        targetStart: money,
        targetEnd: money,
        commissionPercent: z.preprocess(
          (v) => (v === '' || v === null || v === undefined ? 0 : v),
          z.coerce.number().min(0).max(100),
        ),
      }),
    )
    .default([]),
});
export class SaveSalesTargetsDto extends createZodDto(saveSalesTargetsSchema) {}
