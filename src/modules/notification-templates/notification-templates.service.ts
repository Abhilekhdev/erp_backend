import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  customerNotifications,
  defaultNotificationTemplates,
  generalNotifications,
  supplierNotifications,
  type DefaultTemplate,
  type NotificationDef,
} from './notification-templates.constants';
import type { SaveNotificationTemplatesDto } from './dto/save-notification-templates.dto';

/** Shape returned per template — definition (name/tags) merged with the saved/default content. */
export interface TemplateView {
  key: string;
  name: string;
  extra_tags: string[][];
  help_text?: string;
  hide_sms_whatsapp: boolean;
  subject: string;
  email_body: string;
  sms_body: string;
  whatsapp_text: string;
  cc: string;
  bcc: string;
  auto_send: boolean;
  auto_send_sms: boolean;
  auto_send_wa_notif: boolean;
}

@Injectable()
export class NotificationTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /notification-templates — the three notification groups (general/customer/supplier),
   * each template merged with its saved row, falling back to the seed defaults when unsaved.
   * Mirrors NotificationTemplateController@index + __getTemplateDetails.
   */
  async getTemplates(businessId: number) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      include: { currency: { select: { symbol: true } } },
    });
    if (!business) throw new NotFoundException('Business not found');

    const symbol = business.currency?.symbol ?? '';

    const saved = await this.prisma.notificationTemplate.findMany({ where: { businessId } });
    const savedByKey = new Map(saved.map((row) => [row.templateFor, row]));

    // Seed defaults, keyed by template_for — the content a freshly-seeded business would have.
    const defaults = new Map<string, DefaultTemplate>(
      defaultNotificationTemplates(symbol).map((d) => [d.template_for, d]),
    );

    const merge = (def: NotificationDef): TemplateView => {
      const row = savedByKey.get(def.key);
      const fallback = defaults.get(def.key);
      return {
        key: def.key,
        name: def.name,
        extra_tags: def.extraTags,
        ...(def.helpText ? { help_text: def.helpText } : {}),
        hide_sms_whatsapp: Boolean(def.hideSmsWhatsapp),
        subject: row?.subject ?? fallback?.subject ?? '',
        email_body: row?.emailBody ?? fallback?.email_body ?? '',
        sms_body: row?.smsBody ?? fallback?.sms_body ?? '',
        whatsapp_text: row?.whatsappText ?? '',
        cc: row?.cc ?? '',
        bcc: row?.bcc ?? '',
        auto_send: row?.autoSend ?? false,
        auto_send_sms: row?.autoSendSms ?? false,
        auto_send_wa_notif: row?.autoSendWaNotif ?? false,
      };
    };

    return {
      general_notifications: generalNotifications().map(merge),
      customer_notifications: customerNotifications(symbol).map(merge),
      supplier_notifications: supplierNotifications(symbol).map(merge),
    };
  }

  /**
   * POST /notification-templates — upsert each submitted template on (business_id, template_for).
   * Mirrors NotificationTemplateController@store's updateOrCreate loop.
   */
  async saveTemplates(businessId: number, dto: SaveNotificationTemplatesDto) {
    const exists = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Business not found');

    await this.prisma.$transaction(
      dto.templates.map((t) =>
        this.prisma.notificationTemplate.upsert({
          where: { businessId_templateFor: { businessId, templateFor: t.template_for } },
          create: {
            businessId,
            templateFor: t.template_for,
            subject: t.subject ?? null,
            emailBody: t.email_body ?? null,
            smsBody: t.sms_body ?? null,
            whatsappText: t.whatsapp_text ?? null,
            cc: t.cc ?? null,
            bcc: t.bcc ?? null,
            autoSend: t.auto_send,
            autoSendSms: t.auto_send_sms,
            autoSendWaNotif: t.auto_send_wa_notif,
          },
          update: {
            subject: t.subject ?? null,
            emailBody: t.email_body ?? null,
            smsBody: t.sms_body ?? null,
            whatsappText: t.whatsapp_text ?? null,
            cc: t.cc ?? null,
            bcc: t.bcc ?? null,
            autoSend: t.auto_send,
            autoSendSms: t.auto_send_sms,
            autoSendWaNotif: t.auto_send_wa_notif,
          },
        }),
      ),
    );

    return this.getTemplates(businessId);
  }
}
