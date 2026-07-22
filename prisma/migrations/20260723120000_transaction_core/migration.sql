-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('purchase', 'purchase_order', 'purchase_return', 'purchase_transfer', 'opening_stock', 'sell', 'sell_return', 'sell_transfer', 'sales_order', 'opening_balance', 'expense', 'expense_refund', 'stock_adjustment', 'payroll');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('received', 'pending', 'ordered', 'draft', 'final');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('fixed', 'percentage');

-- CreateTable
CREATE TABLE "transactions" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL,
    "contact_id" INTEGER,
    "ref_no" VARCHAR(191) NOT NULL,
    "transaction_date" TIMESTAMP(3) NOT NULL,
    "total_before_tax" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "tax_id" INTEGER,
    "tax_amount" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "discount_type" "DiscountType",
    "discount_amount" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "shipping_details" VARCHAR(191),
    "shipping_charges" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "additional_expenses" JSONB,
    "final_total" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'due',
    "pay_term_number" INTEGER,
    "pay_term_type" "PayTermType",
    "is_approved" BOOLEAN NOT NULL DEFAULT true,
    "approved_by" INTEGER,
    "approved_at" TIMESTAMP(3),
    "exchange_rate" DECIMAL(20,4) NOT NULL DEFAULT 1,
    "return_parent_id" INTEGER,
    "transfer_parent_id" INTEGER,
    "additional_notes" TEXT,
    "staff_note" TEXT,
    "document" VARCHAR(500),
    "custom_field_1" VARCHAR(191),
    "custom_field_2" VARCHAR(191),
    "custom_field_3" VARCHAR(191),
    "custom_field_4" VARCHAR(191),
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_lines" (
    "id" SERIAL NOT NULL,
    "transaction_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "variation_id" INTEGER NOT NULL,
    "quantity" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "sub_unit_id" INTEGER,
    "secondary_unit_quantity" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "quantity_sold" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "quantity_adjusted" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "quantity_returned" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "mfg_quantity_used" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "pp_without_discount" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "discount_percent" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "purchase_price" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "item_tax" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "purchase_price_inc_tax" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "tax_id" INTEGER,
    "lot_number" VARCHAR(191),
    "mfg_date" DATE,
    "exp_date" DATE,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_payments" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "transaction_id" INTEGER,
    "amount" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "method" VARCHAR(191) NOT NULL,
    "account_id" INTEGER,
    "payment_ref_no" VARCHAR(191) NOT NULL,
    "paid_on" TIMESTAMP(3) NOT NULL,
    "is_return" BOOLEAN NOT NULL DEFAULT false,
    "is_advance" BOOLEAN NOT NULL DEFAULT false,
    "payment_for" INTEGER,
    "parent_id" INTEGER,
    "card_transaction_number" VARCHAR(191),
    "card_holder_name" VARCHAR(191),
    "card_type" VARCHAR(191),
    "cheque_number" VARCHAR(191),
    "bank_account_number" VARCHAR(191),
    "transaction_no" VARCHAR(191),
    "note" TEXT,
    "document" VARCHAR(500),
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "transaction_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transactions_business_id_type_transaction_date_idx" ON "transactions"("business_id", "type", "transaction_date" DESC);

-- CreateIndex
CREATE INDEX "transactions_business_id_type_status_idx" ON "transactions"("business_id", "type", "status");

-- CreateIndex
CREATE INDEX "transactions_contact_id_idx" ON "transactions"("contact_id");

-- CreateIndex
CREATE INDEX "transactions_location_id_idx" ON "transactions"("location_id");

-- CreateIndex
CREATE INDEX "transactions_return_parent_id_idx" ON "transactions"("return_parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_business_id_ref_no_key" ON "transactions"("business_id", "ref_no");

-- CreateIndex
CREATE INDEX "purchase_lines_transaction_id_idx" ON "purchase_lines"("transaction_id");

-- CreateIndex
CREATE INDEX "purchase_lines_variation_id_idx" ON "purchase_lines"("variation_id");

-- CreateIndex
CREATE INDEX "purchase_lines_product_id_idx" ON "purchase_lines"("product_id");

-- CreateIndex
CREATE INDEX "purchase_lines_variation_id_exp_date_idx" ON "purchase_lines"("variation_id", "exp_date");

-- CreateIndex
CREATE INDEX "purchase_lines_lot_number_idx" ON "purchase_lines"("lot_number");

-- CreateIndex
CREATE INDEX "transaction_payments_transaction_id_idx" ON "transaction_payments"("transaction_id");

-- CreateIndex
CREATE INDEX "transaction_payments_business_id_paid_on_idx" ON "transaction_payments"("business_id", "paid_on");

-- CreateIndex
CREATE INDEX "transaction_payments_payment_for_idx" ON "transaction_payments"("payment_for");

-- CreateIndex
CREATE INDEX "transaction_payments_account_id_idx" ON "transaction_payments"("account_id");

-- CreateIndex
CREATE INDEX "transaction_payments_parent_id_idx" ON "transaction_payments"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_payments_business_id_payment_ref_no_key" ON "transaction_payments"("business_id", "payment_ref_no");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "business_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tax_id_fkey" FOREIGN KEY ("tax_id") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_return_parent_id_fkey" FOREIGN KEY ("return_parent_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "variations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_tax_id_fkey" FOREIGN KEY ("tax_id") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_payments" ADD CONSTRAINT "transaction_payments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_payments" ADD CONSTRAINT "transaction_payments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_payments" ADD CONSTRAINT "transaction_payments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "transaction_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

