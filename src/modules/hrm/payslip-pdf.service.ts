import { Injectable } from '@nestjs/common';
// The printer lives at pdfmake/src/printer — the package root is the browser build.
import PdfPrinter from 'pdfmake/src/printer';
import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces';

/**
 * Server-side payslip PDF — the port of GOURI's `essentials::payroll.slip` blade, which it renders
 * with mpdf.
 *
 * Engine choice: **pdfmake**, not a headless browser. Puppeteer/wkhtmltopdf would need a ~150 MB
 * Chromium and ~300-800 ms of browser startup per document; pdfmake is pure JS with no external
 * binary and renders this slip in single-digit milliseconds. The printer + font descriptors are
 * built once and reused across requests.
 */

// pdfmake ships Roboto; standard-14 fonts need no files at all and keep the bundle tiny.
const FONTS = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

const GREY = '#666666';

/** "accountHolderName" / "account_holder_name" -> "Account holder name". */
const humanizeKey = (k: string): string => {
  const spaced = k
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export interface PayslipPdfData {
  refNo: string | null;
  monthName: string;
  year: number;
  business: { name: string; currencySymbol: string };
  employee: {
    name: string;
    email: string;
    department: string | null;
    designation: string | null;
    location: string | null;
    bankDetails: Record<string, unknown> | null;
  };
  groupName: string | null;
  basicSalary: number;
  allowances: { description: string; amount: number }[];
  deductions: { description: string; amount: number }[];
  finalTotal: number;
  paymentStatus: string;
  totalPaid: number;
  totalDue: number;
  payments: { paymentRefNo: string | null; amount: number; method: string; paidOn: Date | string }[];
  attendance: { daysInMonth: number; totalLeaves: number; daysPresent: number; workHours: number };
  ytdPayroll: number;
}

@Injectable()
export class PayslipPdfService {
  private readonly printer = new PdfPrinter(FONTS);

  private money(n: number, symbol: string): string {
    return `${symbol} ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private kv(label: string, value: string): Content {
    return {
      columns: [
        { text: label, color: GREY, fontSize: 9, width: '45%' },
        { text: value || '—', fontSize: 9, width: '55%', alignment: 'right' },
      ],
      margin: [0, 1.5, 0, 1.5],
    };
  }

  buildDefinition(d: PayslipPdfData): TDocumentDefinitions {
    const cur = d.business.currencySymbol;

    // Earnings: basic + allowances; then deductions; then the net row.
    const rows: Content[][] = [
      [
        { text: 'Earnings', style: 'th' },
        { text: 'Amount', style: 'th', alignment: 'right' },
      ],
      [
        { text: 'Basic salary', fontSize: 9 },
        { text: this.money(d.basicSalary, cur), fontSize: 9, alignment: 'right' },
      ],
      ...d.allowances.map((a): Content[] => [
        { text: a.description, fontSize: 9 },
        { text: this.money(a.amount, cur), fontSize: 9, alignment: 'right' },
      ]),
    ];

    if (d.deductions.length) {
      rows.push([
        { text: 'Deductions', style: 'th' },
        { text: 'Amount', style: 'th', alignment: 'right' },
      ]);
      d.deductions.forEach((x) =>
        rows.push([
          { text: x.description, fontSize: 9 },
          { text: `- ${this.money(x.amount, cur)}`, fontSize: 9, alignment: 'right', color: '#b91c1c' },
        ]),
      );
    }

    rows.push([
      { text: 'Net payable', bold: true, fontSize: 10, margin: [0, 2, 0, 2] },
      { text: this.money(d.finalTotal, cur), bold: true, fontSize: 10, alignment: 'right', margin: [0, 2, 0, 2] },
    ]);

    const bank = (d.employee.bankDetails ?? {}) as Record<string, string>;
    const bankRows = Object.entries(bank).filter(([, v]) => v);

    const content: Content[] = [
      { text: d.business.name, style: 'h1', alignment: 'center' },
      {
        text: `Payslip for ${d.monthName} ${d.year}`,
        alignment: 'center',
        color: GREY,
        fontSize: 10,
        margin: [0, 2, 0, 0],
      },
      { text: d.refNo ?? '', alignment: 'center', fontSize: 9, margin: [0, 2, 0, 8] },

      // Employee / meta, two columns
      {
        columns: [
          {
            width: '48%',
            stack: [
              this.kv('Employee', d.employee.name),
              this.kv('Email', d.employee.email),
              this.kv('Department', d.employee.department ?? '—'),
            ],
          },
          { width: '4%', text: '' },
          {
            width: '48%',
            stack: [
              this.kv('Designation', d.employee.designation ?? '—'),
              this.kv('Location', d.employee.location ?? '—'),
              this.kv('Payroll group', d.groupName ?? '—'),
            ],
          },
        ],
        margin: [0, 0, 0, 8],
      },

      // Attendance strip
      {
        table: {
          widths: ['*', '*', '*', '*'],
          body: [
            [
              { text: 'Days in month', style: 'th', alignment: 'center' },
              { text: 'Days worked', style: 'th', alignment: 'center' },
              { text: 'Leaves', style: 'th', alignment: 'center' },
              { text: 'Work hours', style: 'th', alignment: 'center' },
            ],
            [
              { text: String(d.attendance.daysInMonth), fontSize: 9, alignment: 'center' },
              { text: String(d.attendance.daysPresent), fontSize: 9, alignment: 'center' },
              { text: String(d.attendance.totalLeaves), fontSize: 9, alignment: 'center' },
              { text: String(d.attendance.workHours), fontSize: 9, alignment: 'center' },
            ],
          ],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 10],
      },

      // Earnings / deductions / net
      { table: { widths: ['*', 120], body: rows }, layout: 'lightHorizontalLines', margin: [0, 0, 0, 10] },

      // Totals
      {
        columns: [
          {
            width: '48%',
            stack: [
              this.kv('Paid', this.money(d.totalPaid, cur)),
              this.kv('Due', this.money(d.totalDue, cur)),
            ],
          },
          { width: '4%', text: '' },
          {
            width: '48%',
            stack: [
              this.kv('Payment status', d.paymentStatus),
              this.kv('YTD payroll', this.money(d.ytdPayroll, cur)),
            ],
          },
        ],
        margin: [0, 0, 0, 10],
      },
    ];

    if (d.payments.length) {
      content.push(
        { text: 'Payments', style: 'h2' },
        {
          table: {
            widths: ['*', 80, 80, 90],
            body: [
              [
                { text: 'Ref No', style: 'th' },
                { text: 'Date', style: 'th' },
                { text: 'Method', style: 'th' },
                { text: 'Amount', style: 'th', alignment: 'right' },
              ],
              ...d.payments.map((p): Content[] => [
                { text: p.paymentRefNo ?? '—', fontSize: 9 },
                { text: new Date(p.paidOn).toISOString().slice(0, 10), fontSize: 9 },
                { text: p.method.replace(/_/g, ' '), fontSize: 9 },
                { text: this.money(p.amount, cur), fontSize: 9, alignment: 'right' },
              ]),
            ],
          },
          layout: 'lightHorizontalLines',
          margin: [0, 0, 0, 10],
        },
      );
    }

    if (bankRows.length) {
      content.push(
        { text: 'Bank details', style: 'h2' },
        {
          stack: bankRows.map(([k, v]) => this.kv(humanizeKey(k), String(v))),
          margin: [0, 0, 0, 6],
        },
      );
    }

    return {
      content,
      pageSize: 'A4',
      pageMargins: [36, 32, 36, 40],
      defaultStyle: { font: 'Helvetica', fontSize: 9, lineHeight: 1.2 },
      info: { title: `Payroll-${d.refNo ?? ''}`, author: d.business.name },
      styles: {
        h1: { fontSize: 15, bold: true },
        h2: { fontSize: 10, bold: true, margin: [0, 4, 0, 4] },
        th: { fontSize: 9, bold: true, fillColor: '#f4f4f5', margin: [0, 3, 0, 3] },
      },
      // Watermark mirrors GOURI's mpdf SetWatermarkText(business name).
      watermark: { text: d.business.name, color: '#000000', opacity: 0.04, bold: true },
      footer: (page: number, total: number) => ({
        columns: [
          { text: `Generated ${new Date().toISOString().slice(0, 10)}`, fontSize: 7, color: GREY, margin: [36, 0, 0, 0] },
          { text: `${page} / ${total}`, fontSize: 7, color: GREY, alignment: 'right', margin: [0, 0, 36, 0] },
        ],
      }),
    };
  }

  /** Render the payslip to a PDF buffer. */
  async render(data: PayslipPdfData): Promise<Buffer> {
    const doc = this.printer.createPdfKitDocument(this.buildDefinition(data));
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });
  }

  /** `Payroll-<ref>.pdf` — same naming GOURI uses for the mail attachment. */
  filename(refNo: string | null): string {
    return `Payroll-${(refNo ?? 'payslip').replace(/[^\w-]/g, '_')}.pdf`;
  }
}
