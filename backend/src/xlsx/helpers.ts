import ExcelJS from 'exceljs';

export interface ColumnDef {
  header: string;
  key: string;
  width?: number;
}

export function buildWorkbook(sheets: { name: string; columns: ColumnDef[]; rows: Record<string, unknown>[] }[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    ws.columns = sheet.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));
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
