-- AlterEnum
ALTER TYPE "TransactionStatus" ADD VALUE 'in_transit';

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "adjustment_type" INTEGER,
ADD COLUMN     "lot_stock_map" JSONB,
ADD COLUMN     "total_amount_recovered" DECIMAL(22,4);

-- CreateTable
CREATE TABLE "wastage_types" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "amount" DECIMAL(22,4),
    "created_by" INTEGER,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "wastage_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_lines" (
    "id" SERIAL NOT NULL,
    "transaction_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "variation_id" INTEGER NOT NULL,
    "quantity" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "lot_no_line_id" INTEGER,
    "lot_allocations" JSONB,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "stock_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wastage_types_business_id_idx" ON "wastage_types"("business_id");

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_transaction_id_idx" ON "stock_adjustment_lines"("transaction_id");

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_variation_id_idx" ON "stock_adjustment_lines"("variation_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_adjustment_type_fkey" FOREIGN KEY ("adjustment_type") REFERENCES "wastage_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wastage_types" ADD CONSTRAINT "wastage_types_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

