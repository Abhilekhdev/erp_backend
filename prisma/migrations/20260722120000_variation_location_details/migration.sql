-- CreateTable
CREATE TABLE "variation_location_details" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "product_variation_id" INTEGER NOT NULL,
    "variation_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "qty_available" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "variation_location_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "variation_location_details_product_id_idx" ON "variation_location_details"("product_id");

-- CreateIndex
CREATE INDEX "variation_location_details_location_id_idx" ON "variation_location_details"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "variation_location_details_variation_id_location_id_key" ON "variation_location_details"("variation_id", "location_id");

-- AddForeignKey
ALTER TABLE "variation_location_details" ADD CONSTRAINT "variation_location_details_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_location_details" ADD CONSTRAINT "variation_location_details_product_variation_id_fkey" FOREIGN KEY ("product_variation_id") REFERENCES "product_variations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_location_details" ADD CONSTRAINT "variation_location_details_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "variations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_location_details" ADD CONSTRAINT "variation_location_details_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "business_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

