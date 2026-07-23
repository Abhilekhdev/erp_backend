-- AddForeignKey
ALTER TABLE "transaction_payments" ADD CONSTRAINT "transaction_payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

