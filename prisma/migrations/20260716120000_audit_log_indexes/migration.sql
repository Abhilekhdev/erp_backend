-- DropIndex
DROP INDEX "audit_logs_action_idx";

-- DropIndex
DROP INDEX "audit_logs_business_id_idx";

-- DropIndex
DROP INDEX "audit_logs_user_id_idx";

-- CreateIndex
CREATE INDEX "audit_logs_business_id_created_at_idx" ON "audit_logs"("business_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_business_id_user_id_created_at_idx" ON "audit_logs"("business_id", "user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_business_id_subject_type_subject_id_created_at_idx" ON "audit_logs"("business_id", "subject_type", "subject_id", "created_at" DESC);

