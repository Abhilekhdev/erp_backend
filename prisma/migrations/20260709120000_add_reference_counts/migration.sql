-- CreateTable
CREATE TABLE "reference_counts" (
    "id" SERIAL NOT NULL,
    "ref_type" VARCHAR(255) NOT NULL,
    "ref_count" INTEGER NOT NULL,
    "business_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "reference_counts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reference_counts_business_id_ref_type_idx" ON "reference_counts"("business_id", "ref_type");
