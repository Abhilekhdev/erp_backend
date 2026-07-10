-- Index the remaining foreign-key columns that lacked a leading index. Postgres does NOT auto-index
-- FKs, so these speed up joins and (importantly) cascade-delete scans on the referenced parent.

-- CreateIndex
CREATE INDEX "business_purchase_currency_id_idx" ON "business"("purchase_currency_id");

-- CreateIndex
CREATE INDEX "user_leave_balances_leave_type_id_idx" ON "user_leave_balances"("leave_type_id");

-- CreateIndex
CREATE INDEX "leaves_leave_type_id_idx" ON "leaves"("leave_type_id");

-- CreateIndex
CREATE INDEX "holidays_location_id_idx" ON "holidays"("location_id");

-- CreateIndex
CREATE INDEX "user_shifts_shift_id_idx" ON "user_shifts"("shift_id");

-- CreateIndex
CREATE INDEX "attendances_essentials_shift_id_idx" ON "attendances"("essentials_shift_id");

-- CreateIndex
CREATE INDEX "payrolls_payroll_group_id_idx" ON "payrolls"("payroll_group_id");
