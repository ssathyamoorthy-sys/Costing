import ExcelJS from 'exceljs';

export interface ColumnDef {
  header: string;
  key: string;
  width?: number;
  numFmt?: string;
}

export function buildWorkbook(sheets: { name: string; columns: ColumnDef[]; rows: Record<string, unknown>[] }[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    ws.columns = sheet.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18, style: c.numFmt ? { numFmt: c.numFmt } : undefined }));
    ws.getRow(1).font = { bold: true };
    for (const row of sheet.rows) ws.addRow(row);
  }
  return wb;
}

export async function parseWorkbookSheet(buffer: Buffer, sheetName: string): Promise<Record<string, string>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`Sheet "${sheetName}" not found in uploaded file`);

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? '').trim();
  });

  const rows: Record<string, string>[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, string> = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber];
      if (!key) return;
      const value = cell.value;
      const str = value == null ? '' : typeof value === 'object' && 'text' in (value as any) ? (value as any).text : String(value);
      if (str !== '') hasValue = true;
      obj[key] = str;
    });
    if (hasValue) rows.push(obj);
  });
  return rows;
}

// Mechanical, assumption-free dump of a workbook's cells as a text grid (cell address -> value,
// one row per line) - for an arbitrary customer-authored spreadsheet whose structure (header
// row, which sheet, which columns) is unknown ahead of time. Unlike parseWorkbookSheet, this
// makes no assumption about a named sheet or a header row; it just hands over the raw grid and
// lets the reader (a human, or an AI prompt) infer the structure. .xlsx/.xls only - a .csv file
// is already plain text and should be read directly instead of going through ExcelJS.
export async function dumpWorkbookAsText(buffer: Buffer, maxRowsPerSheet = 200, maxSheets = 5): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);

  const colLetter = (n: number): string => {
    let s = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };

  const parts: string[] = [];
  for (const ws of wb.worksheets.slice(0, maxSheets)) {
    parts.push(`--- Sheet: ${ws.name} ---`);
    const rowCount = Math.min(ws.rowCount, maxRowsPerSheet);
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) {
        const value = row.getCell(c).value;
        const str =
          value == null
            ? ''
            : typeof value === 'object' && 'text' in (value as any)
              ? (value as any).text
              : typeof value === 'object' && 'result' in (value as any)
                ? String((value as any).result)
                : String(value);
        if (str !== '') cells.push(`${colLetter(c)}=${str}`);
      }
      if (cells.length) parts.push(`Row ${r}: ` + cells.join(' | '));
    }
    if (ws.rowCount > maxRowsPerSheet) parts.push(`... (${ws.rowCount - maxRowsPerSheet} more rows truncated)`);
  }
  return parts.join('\n');
}
