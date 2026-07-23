-- CreateEnum
CREATE TYPE "ShippingStatus" AS ENUM ('ordered', 'packed', 'shipped', 'delivered', 'cancelled');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionStatus" ADD VALUE 'partial';
ALTER TYPE "TransactionStatus" ADD VALUE 'completed';

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'purchase_requisition';

-- AlterTable
ALTER TABLE "purchase_lines" ADD COLUMN     "parent_line_id" INTEGER,
ADD COLUMN     "po_quantity_purchased" DECIMAL(22,4) NOT NULL DEFAULT 0,
ADD COLUMN     "purchase_order_line_id" INTEGER,
ADD COLUMN     "purchase_requisition_line_id" INTEGER;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "delivered_to" VARCHAR(191),
ADD COLUMN     "delivery_date" TIMESTAMP(3),
ADD COLUMN     "purchase_order_ids" JSONB,
ADD COLUMN     "purchase_requisition_ids" JSONB,
ADD COLUMN     "shipping_address" TEXT,
ADD COLUMN     "shipping_status" "ShippingStatus";

-- CreateIndex
CREATE INDEX "purchase_lines_purchase_order_line_id_idx" ON "purchase_lines"("purchase_order_line_id");

-- CreateIndex
CREATE INDEX "purchase_lines_purchase_requisition_line_id_idx" ON "purchase_lines"("purchase_requisition_line_id");

-- CreateIndex
CREATE INDEX "purchase_lines_parent_line_id_idx" ON "purchase_lines"("parent_line_id");

