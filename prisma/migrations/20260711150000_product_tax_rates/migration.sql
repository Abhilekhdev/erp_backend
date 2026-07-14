-- CreateTable
CREATE TABLE "tax_rates" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "amount" DECIMAL(22,4) NOT NULL,
    "is_tax_group" BOOLEAN NOT NULL DEFAULT false,
    "for_tax_group" BOOLEAN NOT NULL DEFAULT false,
    "created_by" INTEGER NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_sub_taxes" (
    "group_tax_id" INTEGER NOT NULL,
    "tax_id" INTEGER NOT NULL,

    CONSTRAINT "group_sub_taxes_pkey" PRIMARY KEY ("group_tax_id","tax_id")
);

-- CreateIndex
CREATE INDEX "tax_rates_business_id_idx" ON "tax_rates"("business_id");

-- CreateIndex
CREATE INDEX "group_sub_taxes_group_tax_id_idx" ON "group_sub_taxes"("group_tax_id");

-- CreateIndex
CREATE INDEX "group_sub_taxes_tax_id_idx" ON "group_sub_taxes"("tax_id");

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_sub_taxes" ADD CONSTRAINT "group_sub_taxes_group_tax_id_fkey" FOREIGN KEY ("group_tax_id") REFERENCES "tax_rates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_sub_taxes" ADD CONSTRAINT "group_sub_taxes_tax_id_fkey" FOREIGN KEY ("tax_id") REFERENCES "tax_rates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

