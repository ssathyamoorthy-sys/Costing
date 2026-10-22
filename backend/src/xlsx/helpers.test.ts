import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { dumpWorkbookAsText } from './helpers';

async function buildFixtureBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inquiry');
  ws.getCell('A1').value = 'Customer';
  ws.getCell('B1').value = 'Greenline';
  ws.getCell('A2').value = 'Color';
  ws.getCell('B2').value = 'White';
  ws.getCell('C2').value = 25; // AC column territory not needed here, just a 3rd populated column
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}

describe('dumpWorkbookAsText', () => {
  it('labels cells by column letter and row number, skipping empty cells', async () => {
    const buffer = await buildFixtureBuffer();
    const text = await dumpWorkbookAsText(buffer);
    expect(text).toContain('--- Sheet: Inquiry ---');
    expect(text).toContain('Row 1: A=Customer | B=Greenline');
    expect(text).toContain('Row 2: A=Color | B=White | C=25');
  });

  it('truncates past maxRowsPerSheet', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Big');
    for (let r = 1; r <= 10; r++) ws.getCell(`A${r}`).value = `row${r}`;
    const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;

    const text = await dumpWorkbookAsText(buffer, 3);
    expect(text).toContain('Row 3: A=row3');
    expect(text).not.toContain('Row 4:');
    expect(text).toContain('7 more rows truncated');
  });

  it('labels columns past Z with two-letter addresses', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Wide');
    ws.getCell(1, 27).value = 'first-after-z'; // column 27 = AA
    const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;

    const text = await dumpWorkbookAsText(buffer);
    expect(text).toContain('AA=first-after-z');
  });
});
