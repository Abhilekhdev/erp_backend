-- CreateEnum
CREATE TYPE "SellSubStatus" AS ENUM ('quotation', 'proforma');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "round_off_amount" DECIMAL(22,4) NOT NULL DEFAULT 0,
ADD COLUMN     "sales_order_ids" JSONB,
ADD COLUMN     "sub_status" "SellSubStatus";

-- CreateTable
CREATE TABLE "transaction_sell_lines" (
    "id" SERIAL NOT NULL,
    "transaction_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "variation_id" INTEGER NOT NULL,
    "quantity" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "sub_unit_id" INTEGER,
    "secondary_unit_quantity" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "quantity_returned" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "unit_price_before_discount" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "line_discount_type" "DiscountType",
    "line_discount_amount" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "item_tax" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "unit_price_inc_tax" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "tax_id" INTEGER,
    "sell_line_note" TEXT,
    "so_line_id" INTEGER,
    "so_quantity_invoiced" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "parent_sell_line_id" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "transaction_sell_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_sell_lines_purchase_lines" (
    "id" SERIAL NOT NULL,
    "sell_line_id" INTEGER NOT NULL,
    "purchase_line_id" INTEGER NOT NULL,
    "quantity" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "qty_returned" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_sell_lines_purchase_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transaction_sell_lines_transaction_id_idx" ON "transaction_sell_lines"("transaction_id");

-- CreateIndex
CREATE INDEX "transaction_sell_lines_variation_id_idx" ON "transaction_sell_lines"("variation_id");

-- CreateIndex
CREATE INDEX "transaction_sell_lines_product_id_idx" ON "transaction_sell_lines"("product_id");

-- CreateIndex
CREATE INDEX "transaction_sell_lines_so_line_id_idx" ON "transaction_sell_lines"("so_line_id");

-- CreateIndex
CREATE INDEX "transaction_sell_lines_parent_sell_line_id_idx" ON "transaction_sell_lines"("parent_sell_line_id");

-- CreateIndex
CREATE INDEX "transaction_sell_lines_purchase_lines_sell_line_id_idx" ON "transaction_sell_lines_purchase_lines"("sell_line_id");

-- CreateIndex
CREATE INDEX "transaction_sell_lines_purchase_lines_purchase_line_id_idx" ON "transaction_sell_lines_purchase_lines"("purchase_line_id");

-- AddForeignKey
ALTER TABLE "transaction_sell_lines" ADD CONSTRAINT "transaction_sell_lines_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_sell_lines" ADD CONSTRAINT "transaction_sell_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_sell_lines" ADD CONSTRAINT "transaction_sell_lines_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "variations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_sell_lines" ADD CONSTRAINT "transaction_sell_lines_tax_id_fkey" FOREIGN KEY ("tax_id") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_sell_lines_purchase_lines" ADD CONSTRAINT "transaction_sell_lines_purchase_lines_sell_line_id_fkey" FOREIGN KEY ("sell_line_id") REFERENCES "transaction_sell_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_sell_lines_purchase_lines" ADD CONSTRAINT "transaction_sell_lines_purchase_lines_purchase_line_id_fkey" FOREIGN KEY ("purchase_line_id") REFERENCES "purchase_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

