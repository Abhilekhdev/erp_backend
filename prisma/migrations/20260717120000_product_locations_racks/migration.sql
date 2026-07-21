-- CreateTable
CREATE TABLE "product_locations" (
    "product_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,

    CONSTRAINT "product_locations_pkey" PRIMARY KEY ("product_id","location_id")
);

-- CreateTable
CREATE TABLE "product_racks" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "rack" VARCHAR(255),
    "row" VARCHAR(255),
    "position" VARCHAR(255),

    CONSTRAINT "product_racks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_locations_location_id_idx" ON "product_locations"("location_id");

-- CreateIndex
CREATE INDEX "product_racks_business_id_idx" ON "product_racks"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_racks_product_id_location_id_key" ON "product_racks"("product_id", "location_id");

-- AddForeignKey
ALTER TABLE "product_locations" ADD CONSTRAINT "product_locations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_locations" ADD CONSTRAINT "product_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "business_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_racks" ADD CONSTRAINT "product_racks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_racks" ADD CONSTRAINT "product_racks_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "business_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_racks" ADD CONSTRAINT "product_racks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

