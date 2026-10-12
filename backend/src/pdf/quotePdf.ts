import PDFDocument from 'pdfkit';
import path from 'path';
import type { CostingBreakup } from '../costing/engine';

const LOGO_PATH = path.join(__dirname, '..', '..', '..', 'assets', 'logo', 'adwaith-lakshmi-logo.jpg');

const CURRENCY_SYMBOL: Record<string, string> = { INR: 'Rs.', USD: '$', GBP: 'GBP ', EUR: 'EUR ' };

interface QuoteForPdf {
  quoteNo: string;
  customerEnquiryNo?: string | null;
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
      yarnComponents: { slot: string; rawMaterial: { code: string; description: string | null } }[];
      items: {
        itemType: { name: string };
        lengthCm: number;
        widthCm: number;
        gsm: number;
        qtyPerSet: number;
        qtyKg: number | null;
        costBreakupJson: string | null;
      }[];
    }[];
  }[];
}

// The Pile slot carries the towel's loop/terry yarn - the one yarn spec a customer actually
// cares about on a price list, so it's shown by its master description (e.g. "16s Ring Spun
// Combed") rather than the internal code, falling back to the code if no description is set.
function pileYarnDescription(seg: { yarnComponents: { slot: string; rawMaterial: { code: string; description: string | null } }[] }) {
  const pile = seg.yarnComponents.find((c) => c.slot.trim().toLowerCase() === 'pile');
  if (!pile) return '';
  return pile.rawMaterial.description || pile.rawMaterial.code;
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
  if (quote.customerEnquiryNo) doc.text(`Customer Enquiry No: ${quote.customerEnquiryNo}`, 40, 140);
  doc.text(`Customer: ${quote.customer.name}`, 300, 112);
  doc.text(`Currency: ${currency}`, 300, 140);
  if (quote.validityDate) doc.text(`Valid until: ${quote.validityDate.toLocaleDateString()}`, 300, 126);

  // One flat table across every item in every Set - no per-Set grouping - with a
  // grand-total footer row.
  const cols = [
    { key: 'item', label: 'Item', width: 55 },
    { key: 'quality', label: 'Quality', width: 75 },
    { key: 'pileYarn', label: 'Pile Yarn', width: 65 },
    { key: 'size', label: 'Size (cm)', width: 45 },
    { key: 'gsm', label: 'GSM', width: 25 },
    { key: 'color', label: 'Color', width: 35 },
    { key: 'qty', label: 'Qty', width: 35, align: 'right' as const },
    { key: 'ratePc', label: `Rate/Pc (${currency})`, width: 55, align: 'right' as const },
    { key: 'totalKg', label: 'Total Qty in Kg', width: 60, align: 'right' as const },
    { key: 'totalValue', label: 'Total Value', width: 60, align: 'right' as const },
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

  ensureRoom(16);
  drawTableRow(
    doc,
    y,
    cols.map((c) => ({ text: c.label, width: c.width, align: c.align })),
    { bold: true },
  );
  y += 12;
  doc.moveTo(40, y).lineTo(40 + tableWidth, y).strokeColor('#dde3ec').stroke();
  y += 4;

  let grandQty = 0;
  let grandKg = 0;
  let grandValue = 0;

  for (const line of quote.lines) {
    for (const seg of line.segments) {
      for (const item of seg.items) {
        const breakup: CostingBreakup | null = item.costBreakupJson ? JSON.parse(item.costBreakupJson) : null;
        const ratePc = breakup?.ratePerPiece?.[currency];
        const qty = line.qtySets * item.qtyPerSet;
        const totalKg = (item.qtyKg ?? 0) * line.qtySets;
        const totalValue = ratePc != null ? ratePc * qty : null;

        grandQty += qty;
        grandKg += totalKg;
        if (totalValue != null) grandValue += totalValue;

        ensureRoom(16);
        drawTableRow(doc, y, [
          { text: item.itemType.name, width: cols[0].width },
          { text: seg.product.name || seg.product.code, width: cols[1].width },
          { text: pileYarnDescription(seg), width: cols[2].width },
          { text: `${item.lengthCm}x${item.widthCm}`, width: cols[3].width },
          { text: String(item.gsm), width: cols[4].width },
          { text: line.color, width: cols[5].width },
          { text: qty.toLocaleString(), width: cols[6].width, align: 'right' },
          { text: ratePc != null ? ratePc.toFixed(2) : '-', width: cols[7].width, align: 'right' },
          { text: totalKg.toFixed(1), width: cols[8].width, align: 'right' },
          { text: totalValue != null ? totalValue.toFixed(2) : '-', width: cols[9].width, align: 'right' },
        ]);
        y += 16;
      }
    }
  }

  ensureRoom(20);
  doc.moveTo(40, y).lineTo(40 + tableWidth, y).strokeColor('#dde3ec').stroke();
  y += 4;
  drawTableRow(
    doc,
    y,
    [
      { text: 'Grand Total', width: cols[0].width + cols[1].width + cols[2].width + cols[3].width + cols[4].width + cols[5].width },
      { text: grandQty.toLocaleString(), width: cols[6].width, align: 'right' },
      { text: '', width: cols[7].width, align: 'right' },
      { text: grandKg.toFixed(1), width: cols[8].width, align: 'right' },
      { text: `${symbol}${grandValue.toFixed(2)}`, width: cols[9].width, align: 'right' },
    ],
    { bold: true },
  );
  y += 22;

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
