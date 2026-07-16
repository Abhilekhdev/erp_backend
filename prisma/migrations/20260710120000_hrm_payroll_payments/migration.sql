-- CreateTable
CREATE TABLE "payroll_payments" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "payroll_id" INTEGER NOT NULL,
    "amount" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "method" VARCHAR(50) NOT NULL,
    "transaction_no" VARCHAR(255),
    "card_transaction_number" VARCHAR(255),
    "card_number" VARCHAR(255),
    "card_type" VARCHAR(50),
    "card_holder_name" VARCHAR(255),
    "card_month" VARCHAR(255),
    "card_year" VARCHAR(255),
    "card_security" VARCHAR(5),
    "cheque_number" VARCHAR(255),
    "bank_account_number" VARCHAR(255),
    "note" TEXT,
    "payment_ref_no" VARCHAR(191),
    "account_id" INTEGER,
    "paid_on" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "payroll_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_payments_business_id_idx" ON "payroll_payments"("business_id");

-- CreateIndex
CREATE INDEX "payroll_payments_payroll_id_idx" ON "payroll_payments"("payroll_id");

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_payroll_id_fkey" FOREIGN KEY ("payroll_id") REFERENCES "payrolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

