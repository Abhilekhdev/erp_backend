-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('pending', 'approved', 'cancelled');

-- CreateTable
CREATE TABLE "user_leave_balances" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "leave_type_id" INTEGER NOT NULL,
    "balance" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "user_leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaves" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "leave_type_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "ref_no" VARCHAR(191),
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "status_note" TEXT,
    "changed_by" INTEGER,
    "changed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "leaves_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_leave_balances_user_id_leave_type_id_key" ON "user_leave_balances"("user_id", "leave_type_id");

-- CreateIndex
CREATE INDEX "user_leave_balances_business_id_idx" ON "user_leave_balances"("business_id");

-- CreateIndex
CREATE INDEX "leaves_business_id_idx" ON "leaves"("business_id");

-- CreateIndex
CREATE INDEX "leaves_user_id_idx" ON "leaves"("user_id");

-- AddForeignKey
ALTER TABLE "user_leave_balances" ADD CONSTRAINT "user_leave_balances_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_leave_balances" ADD CONSTRAINT "user_leave_balances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_leave_balances" ADD CONSTRAINT "user_leave_balances_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
