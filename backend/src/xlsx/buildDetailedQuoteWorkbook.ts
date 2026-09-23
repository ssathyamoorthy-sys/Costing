import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma';
import { resolveCurrentRate } from '../lib/rates';
import { getCurrentExchangeRates } from '../lib/exchangeRates';
import { writeItemSheet, sanitizeSheetName, type ItemSheetContext } from './detailedExport';

const lineFull = {
  segments: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      product: { include: { accessories: { include: { accessoryType: true } } } },
      yarnComponents: { include: { rawMaterial: true } },
      materialOverrides: true,
      items: {
        include: {
          itemType: true,
          accessoryOverrides: { include: { accessoryType: true } },
          packagingCharges: true,
        },
      },
    },
  },
} as const;

/**
 * Builds a full "Price Working"-style workbook for a quote: a summary sheet plus one
 * sheet per item, every cell a live formula (see detailedExport.ts). Supervisor/Admin
 * only - this is the only export that shows the underlying cost build-up.
 */
export async function buildDetailedQuoteWorkbook(quoteId: number): Promise<ExcelJS.Workbook | null> {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { customer: true, lines: { include: lineFull } },
  });
  if (!quote) return null;

  const freightSetting = await prisma.generalSetting.findUnique({ where: { key: 'freightExportPerKg' } });
  const freightExportPerKg = freightSetting ? Number(freightSetting.value) : 0;

  const allRates = await getCurrentExchangeRates();
  const exchangeRateToInr = quote.currency === 'INR' ? 1 : allRates[quote.currency] ?? 1;

  const wb = new ExcelJS.Workbook();
  // Created first so it lands as the first tab; filled in after the item sheets below
  // (once we know each item sheet's name to cross-reference).
  const summaryWs = wb.addWorksheet('Summary');

  const usedSheetNames = new Set<string>(['Summary']);
  function uniqueSheetName(base: string): string {
    let name = sanitizeSheetName(base);
    let i = 2;
    while (usedSheetNames.has(name)) {
      name = sanitizeSheetName(`${base} (${i})`);
      i++;
    }
    usedSheetNames.add(name);
    return name;
  }

  interface SummaryRow {
    setNo: number;
    segment: string;
    item: string;
    size: string;
    qty: number;
    rateKgFormula: string;
    ratePcFormula: string;
  }
  const summaryRows: SummaryRow[] = [];

  for (let lineIdx = 0; lineIdx < quote.lines.length; lineIdx++) {
    const line = quote.lines[lineIdx];
    const processingCharge = await prisma.processingCharge.findFirst({ where: { color: { equals: line.color } } });

    for (const seg of line.segments) {
      const materialOverrideByRawMaterialId = new Map(seg.materialOverrides.map((o) => [o.rawMaterialId, o]));

      const yarnRows: ItemSheetContext['yarnRows'] = [];
      for (const y of seg.yarnComponents) {
        const override = materialOverrideByRawMaterialId.get(y.rawMaterialId);
        if (override) {
          yarnRows.push({
            slot: y.slot,
            materialCode: y.rawMaterial.code,
            mixingPct: y.mixingPct,
            pricePerKg: override.overridePricePerKg,
            overrideNote: override.reason || 'override',
          });
        } else {
          const resolved = await resolveCurrentRate(y.rawMaterialId);
          yarnRows.push({
            slot: y.slot,
            materialCode: y.rawMaterial.code,
            mixingPct: y.mixingPct,
            pricePerKg: resolved?.pricePerKg ?? 0,
            overrideNote: resolved?.isStale ? 'stale rate' : null,
          });
        }
      }

      for (const item of seg.items) {
        const overrideByAccessoryTypeId = new Map(item.accessoryOverrides.map((o) => [o.accessoryTypeId, o.costPerPiece]));
        const accessoryRows = seg.product.accessories.map((a) => ({
          name: a.accessoryType.name,
          costPerPiece: overrideByAccessoryTypeId.get(a.accessoryTypeId) ?? a.costPerPiece,
        }));
        for (const o of item.accessoryOverrides) {
          if (!seg.product.accessories.some((a) => a.accessoryTypeId === o.accessoryTypeId)) {
            accessoryRows.push({ name: o.accessoryType.name, costPerPiece: o.costPerPiece });
          }
        }
        for (const p of item.packagingCharges) {
          accessoryRows.push({ name: p.description, costPerPiece: p.ratePerPiece });
        }

        const ctx: ItemSheetContext = {
          quoteNo: quote.quoteNo,
          customerName: quote.customer.name,
          setNo: lineIdx + 1,
          segmentLabel: `${seg.product.code}${seg.product.name ? ` - ${seg.product.name}` : ''}`,
          itemTypeName: item.itemType.name,
          color: line.color,
          qtySets: line.qtySets,
          currency: quote.currency,
          exchangeRateToInr,
          lengthCm: item.lengthCm,
          widthCm: item.widthCm,
          gsm: item.gsm,
          qtyPerSet: item.qtyPerSet,
          weavingWastagePct: seg.product.weavingWastagePct,
          firstVelourLossPct: seg.product.firstVelourLossPct,
          weightLossPct: seg.product.weightLossPct,
          secondVelourLossPct: seg.product.secondVelourLossPct,
          rejectionPct: seg.product.rejectionPct,
          yarnRows,
          weavingSizingCostPerKg: seg.product.weavingSizingCostPerKg,
          firstVelourCharges: seg.product.firstVelourCharges,
          processingChargeRatePerKg: processingCharge?.ratePerKg ?? 0,
          secondVelourCharges: seg.product.secondVelourCharges,
          transportLocalPerKg: seg.product.transportLocalPerKg,
          stitchingCostPerKg: item.itemType.stitchingCostPerKg,
          packingCostPerKg: item.itemType.packingCostPerKg,
          accessoryRows,
          freightExportPerKg,
          wcInterestPct: quote.customer.wcInterestPct,
          lcInterestPct: quote.customer.lcInterestPct,
          marginPct: quote.customer.marginPct,
          commissionPct: quote.customer.commissionPct,
        };

        const sheetName = uniqueSheetName(`S${lineIdx + 1}-${item.itemType.name}`);
        const ws = wb.addWorksheet(sheetName);
        const { rateKgCell, ratePieceCell } = writeItemSheet(ws, ctx);

        summaryRows.push({
          setNo: lineIdx + 1,
          segment: ctx.segmentLabel,
          item: item.itemType.name,
          size: `${item.lengthCm}x${item.widthCm}`,
          qty: item.qtyPerSet,
          rateKgFormula: rateKgCell,
          ratePcFormula: ratePieceCell,
        });
      }
    }
  }

  summaryWs.mergeCells(1, 1, 1, 7);
  summaryWs.getCell(1, 1).value = `Quote ${quote.quoteNo} - ${quote.customer.name} - ${quote.createdAt.toDateString()} - Currency: ${quote.currency}`;
  summaryWs.getCell(1, 1).font = { bold: true, size: 13 };

  const headers = ['Set #', 'Segment (Quality)', 'Item', 'Size (cm)', 'Qty/Set', `Rate/Kg (${quote.currency})`, `Rate/Pc (${quote.currency})`];
  headers.forEach((h, i) => {
    summaryWs.getCell(3, i + 1).value = h;
    summaryWs.getCell(3, i + 1).font = { bold: true };
  });
  summaryWs.columns = [
    { width: 8 },
    { width: 24 },
    { width: 16 },
    { width: 14 },
    { width: 10 },
    { width: 16 },
    { width: 16 },
  ];

  let row = 4;
  for (const s of summaryRows) {
    summaryWs.getCell(row, 1).value = s.setNo;
    summaryWs.getCell(row, 2).value = s.segment;
    summaryWs.getCell(row, 3).value = s.item;
    summaryWs.getCell(row, 4).value = s.size;
    summaryWs.getCell(row, 5).value = s.qty;
    summaryWs.getCell(row, 6).value = { formula: s.rateKgFormula } as any;
    summaryWs.getCell(row, 7).value = { formula: s.ratePcFormula } as any;
    row++;
  }

  return wb;
}
