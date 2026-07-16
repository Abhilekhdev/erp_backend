/**
 * `@types/pdfmake` only declares the browser entry point; the Node printer (pdfmake/src/printer)
 * ships untyped. This is the minimal surface we use to render a payslip server-side.
 */
declare module 'pdfmake/src/printer' {
  import type { TDocumentDefinitions, TFontDictionary } from 'pdfmake/interfaces';

  /** The PDFKit document pdfmake returns — a readable stream that must be `end()`ed to flush. */
  interface PdfKitDocument extends NodeJS.ReadableStream {
    end(): void;
  }

  export default class PdfPrinter {
    constructor(fonts: TFontDictionary);
    createPdfKitDocument(docDefinition: TDocumentDefinitions, options?: Record<string, unknown>): PdfKitDocument;
  }
}
