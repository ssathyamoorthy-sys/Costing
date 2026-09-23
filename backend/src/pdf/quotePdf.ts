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
  currency: string;
  createdAt: Date;
  customer: { name: string };
  lines: {
    color: string;
    qtySets: number;
    costBreakupJson: string | null;
    segments: {
      product: { code: string; name: string | null };
      items: {
        itemType: { name: string };
        lengthCm: number;
        widthCm: number;
        gsm: number;
        qtyPerSet: number;
        costBreakupJson: string | null;
      }[];
    }[];
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
  const currency = quote.currency;
  const symbol = CURRENCY_SYMBOL[currency] || '';

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
  doc.text(`Currency: ${currency}`, 300, 140);
  if (quote.validityDate) doc.text(`Valid until: ${quote.validityDate.toLocaleDateString()}`, 300, 126);

  const cols = [
    { key: 'item', label: 'Item', width: 85 },
    { key: 'quality', label: 'Quality', width: 55 },
    { key: 'size', label: 'Size (cm)', width: 55 },
    { key: 'gsm', label: 'GSM', width: 30 },
    { key: 'qtyPerSet', label: 'Qty/Set', width: 45, align: 'right' as const },
    { key: 'rateKg', label: `Rate/Kg (${currency})`, width: 65, align: 'right' as const },
    { key: 'ratePc', label: `Rate/Pc (${currency})`, width: 65, align: 'right' as const },
  ];
  const tableWidth = cols.reduce((s, c) => s + c.width, 0);

  let y = 160;
  const pageBottom = 760;
  function ensureRoom(rowHeight: number) {
    if (y + rowHeight > pageBottom) {
      doc.addPage();
      y = 50;
    }
  }

  quote.lines.forEach((line, li) => {
    ensureRoom(60);
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .text(`Set #${li + 1} - Color: ${line.color} - ${line.qtySets.toLocaleString()} set(s) ordered`, 40, y);
    y += 16;

    drawTableRow(
      doc,
      y,
      cols.map((c) => ({ text: c.label, width: c.width, align: c.align })),
      { bold: true },
    );
    y += 12;
    doc.moveTo(40, y).lineTo(40 + tableWidth, y).strokeColor('#dde3ec').stroke();
    y += 4;

    for (const seg of line.segments) {
      for (const item of seg.items) {
        ensureRoom(16);
        const breakup: CostingBreakup | null = item.costBreakupJson ? JSON.parse(item.costBreakupJson) : null;
        const rateKg = breakup?.ratePerKg?.[currency];
        const ratePc = breakup?.ratePerPiece?.[currency];
        drawTableRow(doc, y, [
          { text: item.itemType.name, width: cols[0].width },
          { text: seg.product.name || seg.product.code, width: cols[1].width },
          { text: `${item.lengthCm}x${item.widthCm}`, width: cols[2].width },
          { text: String(item.gsm), width: cols[3].width },
          { text: item.qtyPerSet.toLocaleString(), width: cols[4].width, align: 'right' },
          { text: rateKg != null ? `${symbol}${rateKg.toFixed(2)}` : '-', width: cols[5].width, align: 'right' },
          { text: ratePc != null ? `${symbol}${ratePc.toFixed(2)}` : '-', width: cols[6].width, align: 'right' },
        ]);
        y += 16;
      }
    }

    const setRollup: { ratePerSet: Record<string, number> } | null = line.costBreakupJson ? JSON.parse(line.costBreakupJson) : null;
    const ratePerSet = setRollup?.ratePerSet?.[currency];
    ensureRoom(20);
    y += 4;
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(
        `Combined price / set: ${ratePerSet != null ? `${symbol}${ratePerSet.toFixed(2)}` : '-'}`,
        40,
        y,
        { width: tableWidth, align: 'right' },
      );
    y += 22;
  });

  // --- Terms & conditions ---
  ensureRoom(120);
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
    ensureRoom(14);
    doc.text(`- ${t}`, 40, y, { width: 515 });
    y += 14;
  }

  return doc;
}
