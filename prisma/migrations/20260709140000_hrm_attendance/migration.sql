-- CreateEnum
CREATE TYPE "ShiftType" AS ENUM ('fixed_shift', 'flexible_shift');

-- CreateTable
CREATE TABLE "shifts" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "ShiftType" NOT NULL DEFAULT 'fixed_shift',
    "start_time" VARCHAR(20),
    "end_time" VARCHAR(20),
    "holidays" JSONB,
    "is_allowed_auto_clockout" BOOLEAN NOT NULL DEFAULT false,
    "auto_clockout_time" VARCHAR(20),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_shifts" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "shift_id" INTEGER NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "user_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "clock_in_time" TIMESTAMP(3),
    "clock_out_time" TIMESTAMP(3),
    "ip_address" VARCHAR(255),
    "clock_in_note" TEXT,
    "clock_out_note" TEXT,
    "essentials_shift_id" INTEGER,
    "activity_code_id" INTEGER,
    "clock_in_location" TEXT,
    "clock_out_location" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shifts_business_id_idx" ON "shifts"("business_id");

-- CreateIndex
CREATE INDEX "user_shifts_business_id_idx" ON "user_shifts"("business_id");

-- CreateIndex
CREATE INDEX "user_shifts_user_id_idx" ON "user_shifts"("user_id");

-- CreateIndex
CREATE INDEX "attendances_business_id_idx" ON "attendances"("business_id");

-- CreateIndex
CREATE INDEX "attendances_user_id_idx" ON "attendances"("user_id");

-- RenameForeignKey
ALTER TABLE "essentials_user_allowance_and_deductions" RENAME CONSTRAINT "essentials_user_allow_ded_allowance_deduction_id_fkey" TO "essentials_user_allowance_and_deductions_allowance_deducti_fkey";

-- RenameForeignKey
ALTER TABLE "essentials_user_allowance_and_deductions" RENAME CONSTRAINT "essentials_user_allow_ded_user_id_fkey" TO "essentials_user_allowance_and_deductions_user_id_fkey";

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_shifts" ADD CONSTRAINT "user_shifts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_shifts" ADD CONSTRAINT "user_shifts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_shifts" ADD CONSTRAINT "user_shifts_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_essentials_shift_id_fkey" FOREIGN KEY ("essentials_shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "essentials_user_allow_ded_allowance_deduction_id_idx" RENAME TO "essentials_user_allowance_and_deductions_allowance_deductio_idx";

