-- CreateEnum
CREATE TYPE "PayrollGroupStatus" AS ENUM ('draft', 'final');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('due', 'partial', 'paid');

-- CreateTable
CREATE TABLE "payroll_groups" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "status" "PayrollGroupStatus" NOT NULL DEFAULT 'draft',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'due',
    "gross_total" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "location_id" INTEGER,
    "month" DATE NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "payroll_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payrolls" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "payroll_group_id" INTEGER,
    "user_id" INTEGER NOT NULL,
    "month" DATE NOT NULL,
    "ref_no" VARCHAR(191),
    "basic_salary" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "final_total" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'final',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'due',
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "payrolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_lines" (
    "id" SERIAL NOT NULL,
    "payroll_id" INTEGER NOT NULL,
    "type" "AllowanceDeductionType" NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "amount_type" "AmountType" NOT NULL,
    "amount" DECIMAL(22,4) NOT NULL,
    "computed_amount" DECIMAL(22,4) NOT NULL,

    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_groups_business_id_idx" ON "payroll_groups"("business_id");

-- CreateIndex
CREATE INDEX "payrolls_business_id_idx" ON "payrolls"("business_id");

-- CreateIndex
CREATE INDEX "payrolls_user_id_idx" ON "payrolls"("user_id");

-- CreateIndex
CREATE INDEX "payroll_lines_payroll_id_idx" ON "payroll_lines"("payroll_id");

-- AddForeignKey
ALTER TABLE "payroll_groups" ADD CONSTRAINT "payroll_groups_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_payroll_group_id_fkey" FOREIGN KEY ("payroll_group_id") REFERENCES "payroll_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_payroll_id_fkey" FOREIGN KEY ("payroll_id") REFERENCES "payrolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

