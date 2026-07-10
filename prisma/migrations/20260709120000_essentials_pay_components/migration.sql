-- Pay components (allowances & deductions) — new HRM/payroll tables to reach parity with the
-- legacy user form's `pay_components[]` field. See UsersService (meta + persistence).

-- CreateEnum
CREATE TYPE "AllowanceDeductionType" AS ENUM ('allowance', 'deduction');

-- CreateEnum
CREATE TYPE "AmountType" AS ENUM ('fixed', 'percent', 'test');

-- CreateTable
CREATE TABLE "essentials_allowances_and_deductions" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "description" VARCHAR(191) NOT NULL,
    "type" "AllowanceDeductionType" NOT NULL,
    "amount" DECIMAL(22,4) NOT NULL,
    "amount_type" "AmountType" NOT NULL,
    "applicable_date" DATE,
    "is_approved" INTEGER,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "essentials_allowances_and_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "essentials_user_allowance_and_deductions" (
    "user_id" INTEGER NOT NULL,
    "allowance_deduction_id" INTEGER NOT NULL,

    CONSTRAINT "essentials_user_allowance_and_deductions_pkey" PRIMARY KEY ("user_id","allowance_deduction_id")
);

-- CreateIndex
CREATE INDEX "essentials_allowances_and_deductions_business_id_idx" ON "essentials_allowances_and_deductions"("business_id");

-- CreateIndex
CREATE INDEX "essentials_user_allow_ded_allowance_deduction_id_idx" ON "essentials_user_allowance_and_deductions"("allowance_deduction_id");

-- AddForeignKey
ALTER TABLE "essentials_allowances_and_deductions" ADD CONSTRAINT "essentials_allowances_and_deductions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "essentials_user_allowance_and_deductions" ADD CONSTRAINT "essentials_user_allow_ded_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "essentials_user_allowance_and_deductions" ADD CONSTRAINT "essentials_user_allow_ded_allowance_deduction_id_fkey" FOREIGN KEY ("allowance_deduction_id") REFERENCES "essentials_allowances_and_deductions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
