import ExcelJS from 'exceljs';

// Mirrors the exact row labels writeItemSheet() in detailedExport.ts puts in column A -
// these two files must be kept in sync, since this is a label-based (not position-based)
// reader: it scans column A for these strings rather than trusting fixed row numbers, so a
// Supervisor inserting/deleting a row in Excel while editing doesn't silently misread the
// wrong cell.
const LABELS = {
  quoteNo: 'Quote No',
  length: 'Length (cm)',
  width: 'Width (cm)',
  gsm: 'GSM',
  yarnHeaderSlot: 'Slot',
  yarnHeaderMaterial: 'Material',
  yarnStop: 'Mixing % total',
  wcInterest: 'W.C. Interest %',
  lcInterest: 'LC Interest %',
  margin: 'Margin % (negative adds margin)',
  commission: 'Commission %',
};

export interface ParsedYarnRow {
  slot: string;
  materialCode: string;
  pricePerKg: number;
}

export interface ParsedItemSheet {
  sheetName: string;
  quoteNoInSheet: string | null;
  setNo: number | null;
  itemTypeNameFromSheetName: string | null;
  lengthCm: number | null;
  widthCm: number | null;
  gsm: number | null;
  yarnRows: ParsedYarnRow[];
  marginPct: number | null;
  commissionPct: number | null;
  wcInterestPct: number | null;
  lcInterestPct: number | null;
}

function cellText(ws: ExcelJS.Worksheet, row: number, col: number): string {
  return String(ws.getCell(row, col).value ?? '').trim();
}
function cellNumber(ws: ExcelJS.Worksheet, row: number, col: number): number | null {
  const v = ws.getCell(row, col).value;
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'result' in (v as any)) {
    const r = (v as any).result;
    return typeof r === 'number' ? r : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function findRowByLabel(ws: ExcelJS.Worksheet, label: string, startsWith = false): number | null {
  for (let r = 1; r <= ws.rowCount; r++) {
    const text = cellText(ws, r, 1);
    if (startsWith ? text.startsWith(label) : text === label) return r;
  }
  return null;
}

/** Strips a "(reason/override note)" suffix the export may have appended to a material code. */
function stripOverrideNote(materialCell: string): string {
  return materialCell.split(' (')[0].trim();
}

export function parseCostSheetWorkbook(wb: ExcelJS.Workbook): ParsedItemSheet[] {
  const sheets: ParsedItemSheet[] = [];

  for (const ws of wb.worksheets) {
    if (ws.name === 'Summary') continue;

    // "S{setNo}-{itemTypeName}" per uniqueSheetName() in buildDetailedQuoteWorkbook.ts;
    // a "(2)" disambiguator suffix may follow if the same Set+item name repeats.
    const nameMatch = ws.name.match(/^S(\d+)-(.+?)(?:\s*\(\d+\))?$/);
    const setNo = nameMatch ? Number(nameMatch[1]) : null;
    const itemTypeNameFromSheetName = nameMatch ? nameMatch[2] : null;

    const quoteNoRow = findRowByLabel(ws, LABELS.quoteNo);
    const quoteNoInSheet = quoteNoRow ? cellText(ws, quoteNoRow, 2) || null : null;

    const lengthRow = findRowByLabel(ws, LABELS.length);
    const widthRow = findRowByLabel(ws, LABELS.width);
    const gsmRow = findRowByLabel(ws, LABELS.gsm);

    const yarnRows: ParsedYarnRow[] = [];
    let yarnHeaderRow: number | null = null;
    for (let r = 1; r <= ws.rowCount; r++) {
      if (cellText(ws, r, 1) === LABELS.yarnHeaderSlot && cellText(ws, r, 2) === LABELS.yarnHeaderMaterial) {
        yarnHeaderRow = r;
        break;
      }
    }
    if (yarnHeaderRow) {
      for (let r = yarnHeaderRow + 1; r <= ws.rowCount; r++) {
        const slot = cellText(ws, r, 1);
        if (!slot || slot.startsWith(LABELS.yarnStop)) break;
        const materialCode = stripOverrideNote(cellText(ws, r, 2));
        const price = cellNumber(ws, r, 4);
        if (materialCode && price != null) yarnRows.push({ slot, materialCode, pricePerKg: price });
      }
    }

    const marginRow = findRowByLabel(ws, LABELS.margin);
    const commissionRow = findRowByLabel(ws, LABELS.commission);
    const wcRow = findRowByLabel(ws, LABELS.wcInterest);
    const lcRow = findRowByLabel(ws, LABELS.lcInterest);

    sheets.push({
      sheetName: ws.name,
      quoteNoInSheet,
      setNo,
      itemTypeNameFromSheetName,
      lengthCm: lengthRow ? cellNumber(ws, lengthRow, 2) : null,
      widthCm: widthRow ? cellNumber(ws, widthRow, 2) : null,
      gsm: gsmRow ? cellNumber(ws, gsmRow, 2) : null,
      yarnRows,
      marginPct: marginRow ? cellNumber(ws, marginRow, 2) : null,
      commissionPct: commissionRow ? cellNumber(ws, commissionRow, 2) : null,
      wcInterestPct: wcRow ? cellNumber(ws, wcRow, 2) : null,
      lcInterestPct: lcRow ? cellNumber(ws, lcRow, 2) : null,
    });
  }

  return sheets;
}
