-- A variation can only have ONE price per selling price group. Drop any duplicates that predate the
-- constraint (keeping the newest row) so the unique index can be created.
DELETE FROM "variation_group_prices" a
USING "variation_group_prices" b
WHERE a."variation_id" = b."variation_id"
  AND a."price_group_id" = b."price_group_id"
  AND a."id" < b."id";

-- DropIndex
DROP INDEX "variation_group_prices_variation_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "variation_group_prices_variation_id_price_group_id_key" ON "variation_group_prices"("variation_id", "price_group_id");
