-- CreateIndex
-- Speeds up the Users list: filter (business_id, user_type, deleted_at) + ORDER BY first_name.
-- The equality/IS NULL prefix lets Postgres return rows pre-sorted, avoiding an in-memory sort.
CREATE INDEX "users_business_id_user_type_deleted_at_first_name_idx" ON "users"("business_id", "user_type", "deleted_at", "first_name");
