-- CreateEnum
CREATE TYPE "AccountTransactionType" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "AccountSubType" AS ENUM ('opening_balance', 'fund_transfer', 'deposit');

-- CreateTable
CREATE TABLE "account_types" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "parent_account_type_id" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "account_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "account_number" VARCHAR(191) NOT NULL,
    "account_type_id" INTEGER,
    "account_details" JSONB,
    "note" TEXT,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "created_by" INTEGER NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_transactions" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "type" "AccountTransactionType" NOT NULL,
    "sub_type" "AccountSubType",
    "amount" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "reff_no" VARCHAR(191),
    "operation_date" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "transaction_id" INTEGER,
    "transaction_payment_id" INTEGER,
    "transfer_transaction_id" INTEGER,
    "note" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "account_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_types_business_id_idx" ON "account_types"("business_id");

-- CreateIndex
CREATE INDEX "account_types_parent_account_type_id_idx" ON "account_types"("parent_account_type_id");

-- CreateIndex
CREATE INDEX "accounts_business_id_idx" ON "accounts"("business_id");

-- CreateIndex
CREATE INDEX "accounts_account_type_id_idx" ON "accounts"("account_type_id");

-- CreateIndex
CREATE INDEX "account_transactions_account_id_idx" ON "account_transactions"("account_id");

-- CreateIndex
CREATE INDEX "account_transactions_operation_date_idx" ON "account_transactions"("operation_date");

-- CreateIndex
CREATE INDEX "account_transactions_transaction_id_idx" ON "account_transactions"("transaction_id");

-- CreateIndex
CREATE INDEX "account_transactions_transaction_payment_id_idx" ON "account_transactions"("transaction_payment_id");

-- CreateIndex
CREATE INDEX "account_transactions_transfer_transaction_id_idx" ON "account_transactions"("transfer_transaction_id");

-- AddForeignKey
ALTER TABLE "account_types" ADD CONSTRAINT "account_types_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_types" ADD CONSTRAINT "account_types_parent_account_type_id_fkey" FOREIGN KEY ("parent_account_type_id") REFERENCES "account_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_account_type_id_fkey" FOREIGN KEY ("account_type_id") REFERENCES "account_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transactions" ADD CONSTRAINT "account_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transactions" ADD CONSTRAINT "account_transactions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transactions" ADD CONSTRAINT "account_transactions_transaction_payment_id_fkey" FOREIGN KEY ("transaction_payment_id") REFERENCES "transaction_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transactions" ADD CONSTRAINT "account_transactions_transfer_transaction_id_fkey" FOREIGN KEY ("transfer_transaction_id") REFERENCES "account_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

