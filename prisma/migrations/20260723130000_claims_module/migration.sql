-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('pending', 'approved', 'unapproved');

-- CreateTable
CREATE TABLE "claim_reimbursement_category" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "code" VARCHAR(191),
    "parent_id" INTEGER,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "claim_reimbursement_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_reimbursement" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "ref_no" VARCHAR(191),
    "description" VARCHAR(255) NOT NULL,
    "amount" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "claim_category_id" INTEGER,
    "claim_sub_category_id" INTEGER,
    "applicable_date" DATE,
    "document" VARCHAR(191),
    "status" "ClaimStatus" NOT NULL DEFAULT 'pending',
    "status_note" TEXT,
    "changed_by" INTEGER,
    "changed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "claim_reimbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_claim_reimbursement" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "claim_reimbursement_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "user_claim_reimbursement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "claim_reimbursement_category_business_id_idx" ON "claim_reimbursement_category"("business_id");

-- CreateIndex
CREATE INDEX "claim_reimbursement_category_parent_id_idx" ON "claim_reimbursement_category"("parent_id");

-- CreateIndex
CREATE INDEX "claim_reimbursement_business_id_idx" ON "claim_reimbursement"("business_id");

-- CreateIndex
CREATE INDEX "claim_reimbursement_claim_category_id_idx" ON "claim_reimbursement"("claim_category_id");

-- CreateIndex
CREATE INDEX "user_claim_reimbursement_business_id_idx" ON "user_claim_reimbursement"("business_id");

-- CreateIndex
CREATE INDEX "user_claim_reimbursement_user_id_idx" ON "user_claim_reimbursement"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_claim_reimbursement_claim_reimbursement_id_user_id_key" ON "user_claim_reimbursement"("claim_reimbursement_id", "user_id");

-- AddForeignKey
ALTER TABLE "claim_reimbursement_category" ADD CONSTRAINT "claim_reimbursement_category_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_reimbursement_category" ADD CONSTRAINT "claim_reimbursement_category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "claim_reimbursement_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_reimbursement" ADD CONSTRAINT "claim_reimbursement_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_reimbursement" ADD CONSTRAINT "claim_reimbursement_claim_category_id_fkey" FOREIGN KEY ("claim_category_id") REFERENCES "claim_reimbursement_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_claim_reimbursement" ADD CONSTRAINT "user_claim_reimbursement_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_claim_reimbursement" ADD CONSTRAINT "user_claim_reimbursement_claim_reimbursement_id_fkey" FOREIGN KEY ("claim_reimbursement_id") REFERENCES "claim_reimbursement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_claim_reimbursement" ADD CONSTRAINT "user_claim_reimbursement_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
