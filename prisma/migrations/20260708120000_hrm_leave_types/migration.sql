-- CreateEnum
CREATE TYPE "LeaveCountInterval" AS ENUM ('month', 'year');

-- CreateTable
CREATE TABLE "leave_types" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "leave_type" VARCHAR(255) NOT NULL,
    "max_leave_count" INTEGER,
    "leave_count_interval" "LeaveCountInterval",
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leave_types_business_id_idx" ON "leave_types"("business_id");

-- AddForeignKey
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
