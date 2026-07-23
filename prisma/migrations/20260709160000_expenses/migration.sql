-- Expenses module: expense categories + the expense-specific columns on transactions
-- (type = 'expense' / 'expense_refund'). Mirrors GOURI_DEV expense_categories + transactions.

-- CreateEnum
CREATE TYPE "RecurIntervalType" AS ENUM ('days', 'months', 'years');

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "business_id" INTEGER NOT NULL,
    "code" VARCHAR(191),
    "parent_id" INTEGER,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_categories_business_id_idx" ON "expense_categories"("business_id");

-- CreateIndex
CREATE INDEX "expense_categories_parent_id_idx" ON "expense_categories"("parent_id");

-- AlterTable
ALTER TABLE "transactions"
    ADD COLUMN "expense_category_id" INTEGER,
    ADD COLUMN "expense_sub_category_id" INTEGER,
    ADD COLUMN "expense_for" INTEGER,
    ADD COLUMN "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "recur_interval" DECIMAL(22,4),
    ADD COLUMN "recur_interval_type" "RecurIntervalType",
    ADD COLUMN "recur_repetitions" INTEGER,
    ADD COLUMN "recur_stopped_on" TIMESTAMP(3),
    ADD COLUMN "recur_parent_id" INTEGER;

-- CreateIndex
CREATE INDEX "transactions_expense_category_id_idx" ON "transactions"("expense_category_id");

-- CreateIndex
CREATE INDEX "transactions_expense_sub_category_id_idx" ON "transactions"("expense_sub_category_id");

-- CreateIndex
CREATE INDEX "transactions_expense_for_idx" ON "transactions"("expense_for");

-- CreateIndex
CREATE INDEX "transactions_recur_parent_id_idx" ON "transactions"("recur_parent_id");

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_expense_category_id_fkey" FOREIGN KEY ("expense_category_id") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_expense_sub_category_id_fkey" FOREIGN KEY ("expense_sub_category_id") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
