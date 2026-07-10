-- CreateTable
CREATE TABLE "notification_templates" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "template_for" VARCHAR(255) NOT NULL,
    "email_body" TEXT,
    "sms_body" TEXT,
    "whatsapp_text" TEXT,
    "subject" VARCHAR(255),
    "cc" VARCHAR(255),
    "bcc" VARCHAR(255),
    "auto_send" BOOLEAN NOT NULL DEFAULT false,
    "auto_send_sms" BOOLEAN NOT NULL DEFAULT false,
    "auto_send_wa_notif" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_templates_business_id_idx" ON "notification_templates"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_business_id_template_for_key" ON "notification_templates"("business_id", "template_for");

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
