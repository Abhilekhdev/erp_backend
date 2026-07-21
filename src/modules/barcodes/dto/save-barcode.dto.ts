import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Every measurement is inches and optional — a continuous roll leaves the sheet fields blank. */
const size = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().min(0).optional(),
);
const count = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().int().positive().optional(),
);

export const saveBarcodeSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(255),
    description: z.string().optional(),
    width: size,
    height: size,
    paper_width: size,
    paper_height: size,
    top_margin: size,
    left_margin: size,
    row_distance: size,
    col_distance: size,
    stickers_in_one_row: count,
    stickers_in_one_sheet: count,
    is_continuous: z.coerce.boolean().optional().default(false),
  })
  // A sheet layout needs to know how many stickers fit across; a continuous roll does not tile.
  .refine((d) => d.is_continuous || d.stickers_in_one_row != null, {
    message: 'Stickers in one row is required for a sheet layout',
    path: ['stickers_in_one_row'],
  });

export class SaveBarcodeDto extends createZodDto(saveBarcodeSchema) {}
