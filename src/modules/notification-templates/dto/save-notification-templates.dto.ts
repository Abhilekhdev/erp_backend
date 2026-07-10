import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Save payload for the Notification Templates page — mirrors the Laravel
 * `template_data[<template_for>][<field>]` structure (NotificationTemplateController@store),
 * flattened into an array of per-template rows. Each row is upserted on (business_id, template_for).
 */
const templateRowSchema = z.object({
  template_for: z.string().min(1).max(255),
  subject: z.string().max(255).nullish(),
  email_body: z.string().nullish(),
  sms_body: z.string().nullish(),
  whatsapp_text: z.string().nullish(),
  cc: z.string().max(255).nullish(),
  bcc: z.string().max(255).nullish(),
  // Tolerant of legacy 0/1/'1'/true checkbox values, coerced to boolean.
  auto_send: z.coerce.boolean().optional().default(false),
  auto_send_sms: z.coerce.boolean().optional().default(false),
  auto_send_wa_notif: z.coerce.boolean().optional().default(false),
});

export const saveNotificationTemplatesSchema = z.object({
  templates: z.array(templateRowSchema).min(1),
});

export type TemplateRow = z.infer<typeof templateRowSchema>;

export class SaveNotificationTemplatesDto extends createZodDto(saveNotificationTemplatesSchema) {}
