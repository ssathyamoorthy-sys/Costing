import PDFDocument from 'pdfkit';
import path from 'path';
import type { CostingBreakup } from '../costing/engine';

const LOGO_PATH = path.join(__dirname, '..', '..', '..', 'assets', 'logo', 'adwaith-lakshmi-logo.jpg');

const CURRENCY_SYMBOL: Record<string, string> = { INR: 'Rs.', USD: '$', GBP: 'GBP ', EUR: 'EUR ' };

interface QuoteForPdf {
  quoteNo: string;
  status: string;
  validityDate: Date | null;
  paymentTerms: string | null;
  freightTerms: string | null;
  currencies: string;
  createdAt: Date;
  customer: { name: string };
  lines: {
    product: { code: string; name: string | null };
    itemType: { name: string };
    color: string;
    lengthCm: number;
    widthCm: number;
    gsm: number;
    qtyPcs: number;
    qtyKg: number | null;
    costBreakupJson: string | null;
  }[];
}

function drawTableRow(doc: PDFKit.PDFDocument, y: number, cols: { text: string; width: number; align?: 'left' | 'right' }[], opts: { bold?: boolean } = {}) {
  let x = doc.page.margins.left;
  doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
  for (const col of cols) {
    doc.text(col.text, x, y, { width: col.width, align: col.align || 'left' });
    x += col.width;
  }
}

export function generateQuotePdf(quote: QuoteForPdf): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const currencies = quote.currencies.split(',');

  // --- Letterhead ---
  try {
    doc.image(LOGO_PATH, 40, 30, { height: 36 });
  } catch {
    // logo missing - continue without it rather than failing the whole document
  }
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .text('Adwaith Lakshmi Industries Pvt. Ltd.', 200, 32, { align: 'right' });
  doc
    .font('Helvetica')
    .fontSize(9)
    .text('Coimbatore - 641 028, India', 200, 50, { align: 'right' });

  doc.moveTo(40, 78).lineTo(555, 78).strokeColor('#1b2560').stroke();

  doc.font('Helvetica-Bold').fontSize(14).fillColor('#1b2560').text('PRICE LIST / QUOTATION', 40, 90);
  doc.fillColor('black');

  doc.font('Helvetica').fontSize(9);
  doc.text(`Quote No: ${quote.quoteNo}`, 40, 112);
  doc.text(`Date: ${quote.createdAt.toLocaleDateString()}`, 40, 126);
  doc.text(`Customer: ${quote.customer.name}`, 300, 112);
  if (quote.validityDate) doc.text(`Valid until: ${quote.validityDate.toLocaleDateString()}`, 300, 126);

  // --- Line items table (one block per currency) ---
  let y = 160;
  const cols = [
    { key: 'sno', label: 'S.No', width: 28 },
    { key: 'item', label: 'Item', width: 90 },
    { key: 'quality', label: 'Quality', width: 55 },
    { key: 'size', label: 'Size (cm)', width: 55 },
    { key: 'gsm', label: 'GSM', width: 35 },
    { key: 'color', label: 'Color', width: 55 },
    { key: 'qtyPcs', label: 'Qty (Pcs)', width: 55, align: 'right' as const },
    { key: 'rateKg', label: 'Rate/Kg', width: 55, align: 'right' as const },
    { key: 'ratePc', label: 'Rate/Pc', width: 55, align: 'right' as const },
  ];

  for (const currency of currencies) {
    doc.font('Helvetica-Bold').fontSize(10).text(`Currency: ${currency}`, 40, y);
    y += 16;
    drawTableRow(
      doc,
      y,
      cols.map((c) => ({ text: c.label, width: c.width, align: c.align })),
      { bold: true },
    );
    y += 12;
    doc.moveTo(40, y).lineTo(555, y).strokeColor('#dde3ec').stroke();
    y += 4;

    quote.lines.forEach((line, i) => {
      const breakup: CostingBreakup | null = line.costBreakupJson ? JSON.parse(line.costBreakupJson) : null;
      const rateKg = breakup?.ratePerKg?.[currency];
      const ratePc = breakup?.ratePerPiece?.[currency];
      const symbol = CURRENCY_SYMBOL[currency] || '';
      drawTableRow(doc, y, [
        { text: String(i + 1), width: cols[0].width },
        { text: line.itemType.name, width: cols[1].width },
        { text: line.product.name || line.product.code, width: cols[2].width },
        { text: `${line.lengthCm}x${line.widthCm}`, width: cols[3].width },
        { text: String(line.gsm), width: cols[4].width },
        { text: line.color, width: cols[5].width },
        { text: line.qtyPcs.toLocaleString(), width: cols[6].width, align: 'right' },
        { text: rateKg != null ? `${symbol}${rateKg.toFixed(2)}` : '-', width: cols[7].width, align: 'right' },
        { text: ratePc != null ? `${symbol}${ratePc.toFixed(2)}` : '-', width: cols[8].width, align: 'right' },
      ]);
      y += 16;
    });
    y += 14;
  }

  // --- Terms & conditions ---
  y += 6;
  doc.font('Helvetica-Bold').fontSize(10).text('Terms and Conditions', 40, y);
  y += 16;
  doc.font('Helvetica').fontSize(8.5);
  const terms = [
    quote.paymentTerms ? `Payment Terms: ${quote.paymentTerms}` : null,
    quote.freightTerms ? `Freight Terms: ${quote.freightTerms}` : null,
    'Quantity Tolerance: +/- 5%',
    'Dimensional Tolerance - Length/Width: +/- 5%, Weight: +/- 3%',
    'Standard packing: one woven care label plus polybag and carton packing',
    quote.validityDate ? `This quotation is valid until ${quote.validityDate.toLocaleDateString()}.` : 'This quotation is valid for 7 days from the date above unless stated otherwise.',
  ].filter(Boolean) as string[];

  for (const t of terms) {
    doc.text(`- ${t}`, 40, y, { width: 515 });
    y += 14;
  }

  return doc;
}
