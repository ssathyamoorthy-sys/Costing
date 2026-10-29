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
          hsnCode: true,
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
  const masterFreightExportPerKg = freightSetting ? Number(freightSetting.value) : 0;
  const freightExportPerKg = quote.freightExportPerKgOverride ?? masterFreightExportPerKg;

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
    gsmFormula: string;
    qty: number;
    qtyPerSetFormula: string;
    qtySets: number;
    qtyKgPerSetFormula: string;
    rateKgFormula: string;
    ratePcFormula: string;
    marginPctFormula: string;
  }
  const summaryRows: SummaryRow[] = [];

  for (let lineIdx = 0; lineIdx < quote.lines.length; lineIdx++) {
    const line = quote.lines[lineIdx];
    const processingCharge = await prisma.processingCharge.findFirst({ where: { color: { equals: line.color } } });
    const processingChargeRatePerKg = line.processingChargeRatePerKgOverride ?? processingCharge?.ratePerKg ?? 0;

    for (const seg of line.segments) {
      const materialOverrideByRawMaterialId = new Map(seg.materialOverrides.map((o) => [o.rawMaterialId, o]));

      const isYarnDyed = seg.product.colorMethod === 'YARN_DYED';

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
            dyeingCostPerKg: y.dyeingCostPerKg,
            dyeVariant: y.dyeVariant,
          });
        } else {
          const resolved = await resolveCurrentRate(y.rawMaterialId);
          yarnRows.push({
            slot: y.slot,
            materialCode: y.rawMaterial.code,
            mixingPct: y.mixingPct,
            pricePerKg: resolved?.pricePerKg ?? 0,
            overrideNote: resolved?.isStale ? 'stale rate' : null,
            dyeingCostPerKg: y.dyeingCostPerKg,
            dyeVariant: y.dyeVariant,
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

        const isGarment = item.itemType.sizingMethod === 'FABRIC_CONSUMPTION';

        const ctx: ItemSheetContext = {
          quoteNo: quote.quoteNo,
          customerEnquiryNo: quote.customerEnquiryNo,
          customerName: quote.customer.name,
          setNo: lineIdx + 1,
          segmentLabel: `${seg.product.code}${seg.product.name ? ` - ${seg.product.name}` : ''}`,
          itemTypeName: item.itemType.name,
          color: line.color,
          qtySets: line.qtySets,
          currency: quote.currency,
          exchangeRateToInr,
          colorMethod: seg.product.colorMethod as 'PIECE_DYED' | 'YARN_DYED',
          itemClass: isGarment ? 'GARMENT' : 'FLAT',
          lengthCm: item.lengthCm,
          widthCm: item.widthCm,
          fabricConsumptionSqm: item.fabricConsumptionSqm ?? 0,
          gsm: item.gsm,
          qtyPerSet: item.qtyPerSet,
          weavingWastagePct: seg.product.weavingWastagePct,
          firstVelourLossPct: seg.product.firstVelourLossPct,
          weightLossPct: seg.product.weightLossPct,
          washingLossPct: seg.product.washingLossPct,
          secondVelourLossPct: seg.product.secondVelourLossPct,
          rejectionPct: seg.product.rejectionPct,
          secondRejectionPct: seg.product.secondRejectionPct,
          yarnDyeingProcessLossPct: seg.product.yarnDyeingProcessLossPct,
          yarnRows,
          weavingSizingCostPerKg: seg.weavingSizingCostPerKgOverride ?? seg.product.weavingSizingCostPerKg,
          firstVelourCharges: seg.firstVelourChargesOverride ?? seg.product.firstVelourCharges,
          processingChargeRatePerKg,
          washingCostPerKg: seg.washingCostPerKgOverride ?? seg.product.washingCostPerKg,
          secondVelourCharges: seg.secondVelourChargesOverride ?? seg.product.secondVelourCharges,
          transportLocalPerKg: seg.transportLocalPerKgOverride ?? seg.product.transportLocalPerKg,
          stitchingCostPerKg: item.stitchingCostPerKgOverride ?? item.itemType.stitchingCostPerKg,
          stitchingCostPerPiece: item.stitchingCostPerPieceOverride ?? item.itemType.stitchingCostPerPiece,
          packingCostPerKg: item.packingCostPerKgOverride ?? item.itemType.packingCostPerKg,
          accessoryRows,
          freightExportPerKg,
          wcInterestPct: quote.wcInterestPctOverride ?? quote.customer.wcInterestPct,
          lcInterestPct: quote.lcInterestPctOverride ?? quote.customer.lcInterestPct,
          marginPct: line.marginPctOverride ?? quote.marginPctOverride ?? quote.customer.marginPct,
          commissionPct: quote.commissionPctOverride ?? quote.customer.commissionPct,
          hsnCode: item.hsnCode?.hsCode ?? null,
          dbkPct: item.hsnCode?.dbkPct ?? 0,
          rosctlRodepPct: item.hsnCode?.rosctlRodepPct ?? 0,
        };

        const sheetName = uniqueSheetName(`S${lineIdx + 1}-${item.itemType.name}`);
        const ws = wb.addWorksheet(sheetName);
        const { rateKgCell, ratePieceCell, gsmCell, qtyPerSetCell, qtyKgPerSetCell, marginPctCell } = writeItemSheet(ws, ctx);

        summaryRows.push({
          setNo: lineIdx + 1,
          segment: ctx.segmentLabel,
          item: item.itemType.name,
          size: isGarment ? `${item.fabricConsumptionSqm} sqm fabric` : `${item.widthCm}x${item.lengthCm}`,
          gsmFormula: gsmCell,
          qty: item.qtyPerSet,
          qtyPerSetFormula: qtyPerSetCell,
          qtySets: line.qtySets,
          qtyKgPerSetFormula: qtyKgPerSetCell,
          rateKgFormula: rateKgCell,
          ratePcFormula: ratePieceCell,
          marginPctFormula: marginPctCell,
        });
      }
    }
  }

  summaryWs.mergeCells(1, 1, 1, 12);
  const summaryTitleParts = [`Quote ${quote.quoteNo}`];
  if (quote.customerEnquiryNo) summaryTitleParts.push(`Enquiry No ${quote.customerEnquiryNo}`);
  summaryTitleParts.push(quote.customer.name, quote.createdAt.toDateString(), `Currency: ${quote.currency}`);
  summaryWs.getCell(1, 1).value = summaryTitleParts.join(' - ');
  summaryWs.getCell(1, 1).font = { bold: true, size: 13 };

  const YELLOW_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  const headers = [
    'Set #',
    'Segment (Quality)',
    'Item',
    'Size (cm)',
    'GSM',
    'Qty/Set',
    'Qty in Pcs',
    'Qty in Kg',
    `Rate/Kg (${quote.currency})`,
    `Rate/Pc (${quote.currency})`,
    'Margin %',
    'Total Margin',
  ];
  const highlightedHeaders = new Set(['GSM', 'Qty in Pcs', 'Qty in Kg', 'Margin %', 'Total Margin']);
  headers.forEach((h, i) => {
    const cell = summaryWs.getCell(3, i + 1);
    cell.value = h;
    cell.font = { bold: true };
    if (highlightedHeaders.has(h)) cell.fill = YELLOW_FILL;
  });
  summaryWs.columns = [
    { width: 8 },
    { width: 24 },
    { width: 16 },
    { width: 14 },
    { width: 8 },
    { width: 10 },
    { width: 12 },
    { width: 12 },
    { width: 16 },
    { width: 16 },
    { width: 10 },
    { width: 16 },
  ];

  let row = 4;
  const firstDataRow = row;
  for (const s of summaryRows) {
    summaryWs.getCell(row, 1).value = s.setNo;
    summaryWs.getCell(row, 2).value = s.segment;
    summaryWs.getCell(row, 3).value = s.item;
    summaryWs.getCell(row, 4).value = s.size;
    summaryWs.getCell(row, 5).value = { formula: s.gsmFormula } as any;
    summaryWs.getCell(row, 6).value = { formula: s.qtyPerSetFormula } as any;
    // Qty in Pcs / Qty in Kg are for the WHOLE order (qtySets sets), not just one set - the
    // number of sets ordered isn't itself a cell anywhere in this workbook (it lives on the
    // quote line, outside any one item's sheet), so it's baked in as a literal multiplier.
    summaryWs.getCell(row, 7).value = { formula: `F${row}*${s.qtySets}` } as any;
    summaryWs.getCell(row, 7).numFmt = '#,##0';
    summaryWs.getCell(row, 8).value = { formula: `${s.qtyKgPerSetFormula}*${s.qtySets}` } as any;
    summaryWs.getCell(row, 8).numFmt = '#,##0.000';
    summaryWs.getCell(row, 9).value = { formula: s.rateKgFormula } as any;
    summaryWs.getCell(row, 9).numFmt = '#,##0.0000';
    summaryWs.getCell(row, 10).value = { formula: s.ratePcFormula } as any;
    summaryWs.getCell(row, 10).numFmt = '#,##0.0000';
    summaryWs.getCell(row, 11).value = { formula: s.marginPctFormula } as any;
    summaryWs.getCell(row, 11).numFmt = '0.00%';
    // Total Margin = Rate/Pc x Qty in Pcs x Margin % - the margin earned on this row's full
    // ordered quantity, in the quote's currency.
    summaryWs.getCell(row, 12).value = { formula: `J${row}*G${row}*K${row}` } as any;
    summaryWs.getCell(row, 12).numFmt = '#,##0.00';
    row++;
  }
  const lastDataRow = row - 1;

  if (summaryRows.length > 0) {
    const totalsRow = row;
    summaryWs.getCell(totalsRow, 2).value = 'TOTAL / CONSOLIDATED';
    summaryWs.getCell(totalsRow, 2).font = { bold: true };
    summaryWs.getCell(totalsRow, 7).value = { formula: `SUM(G${firstDataRow}:G${lastDataRow})` } as any;
    summaryWs.getCell(totalsRow, 7).numFmt = '#,##0';
    summaryWs.getCell(totalsRow, 8).value = { formula: `SUM(H${firstDataRow}:H${lastDataRow})` } as any;
    summaryWs.getCell(totalsRow, 8).numFmt = '#,##0.000';
    summaryWs.getCell(totalsRow, 12).value = { formula: `SUM(L${firstDataRow}:L${lastDataRow})` } as any;
    summaryWs.getCell(totalsRow, 12).numFmt = '#,##0.00';
    // Consolidated (revenue-weighted) margin % for the whole enquiry: total margin divided
    // by total revenue (Rate/Pc x Qty in Pcs, summed across every row).
    summaryWs.getCell(totalsRow, 11).value = {
      formula: `L${totalsRow}/SUMPRODUCT(J${firstDataRow}:J${lastDataRow},G${firstDataRow}:G${lastDataRow})`,
    } as any;
    summaryWs.getCell(totalsRow, 11).numFmt = '0.00%';
    for (const col of [2, 7, 8, 11, 12]) {
      summaryWs.getCell(totalsRow, col).font = { bold: true };
      summaryWs.getCell(totalsRow, col).fill = YELLOW_FILL;
    }
  }

  return wb;
}
