-- CreateTable
CREATE TABLE "units" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "actual_name" VARCHAR(255) NOT NULL,
    "short_name" VARCHAR(255) NOT NULL,
    "allow_decimal" BOOLEAN NOT NULL DEFAULT false,
    "base_unit_id" INTEGER,
    "base_unit_multiplier" DECIMAL(20,4),
    "created_by" INTEGER NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "units_business_id_idx" ON "units"("business_id");

-- CreateIndex
CREATE INDEX "units_base_unit_id_idx" ON "units"("base_unit_id");

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_base_unit_id_fkey" FOREIGN KEY ("base_unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

