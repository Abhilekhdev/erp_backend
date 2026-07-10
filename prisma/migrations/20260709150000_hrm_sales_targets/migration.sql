-- CreateTable
CREATE TABLE "essentials_user_sales_targets" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "target_start" DECIMAL(22,4) NOT NULL,
    "target_end" DECIMAL(22,4) NOT NULL,
    "commission_percent" DECIMAL(22,4) NOT NULL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "essentials_user_sales_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "essentials_user_sales_targets_business_id_idx" ON "essentials_user_sales_targets"("business_id");

-- CreateIndex
CREATE INDEX "essentials_user_sales_targets_user_id_idx" ON "essentials_user_sales_targets"("user_id");

-- AddForeignKey
ALTER TABLE "essentials_user_sales_targets" ADD CONSTRAINT "essentials_user_sales_targets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "essentials_user_sales_targets" ADD CONSTRAINT "essentials_user_sales_targets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

