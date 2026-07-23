import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const optStr = z.preprocess(blank, z.string().max(191).optional());

/**
 * One lot of opening stock: a starting quantity for a variation at a location, at a known cost.
 * A variation-location can carry several lots (different cost / expiry / lot number).
 */
export const openingStockLotSchema = z.object({
  location_id: z.coerce.number().int().positive(),
  variation_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().min(0),
  /** Unit cost before tax. GOURI defaults it to the variation's default purchase price. */
  purchase_price: z.preprocess(blank, z.coerce.number().min(0).optional().default(0)),
  exp_date: optStr,
  lot_number: optStr,
  note: z.preprocess(blank, z.string().optional()),
  secondary_unit_quantity: z.preprocess(blank, z.coerce.number().min(0).optional().default(0)),
});

export const saveOpeningStockSchema = z.object({
  /**
   * One date for the whole document. GOURI takes a per-line date and lets any value through with no
   * validation (and defaults to the financial-year start); one document date is simpler and honest.
   */
  transaction_date: z.preprocess(blank, z.string().optional()),
  /** The full desired state — this REPLACES the product's existing opening stock. */
  lots: z.array(openingStockLotSchema),
});

export type OpeningStockLotInput = z.infer<typeof openingStockLotSchema>;
export class SaveOpeningStockDto extends createZodDto(saveOpeningStockSchema) {}
