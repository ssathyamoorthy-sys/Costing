// Client-side "download this table as a CSV" - no backend involvement, reuses whatever
// rows/columns a report already has in state. Values are read as plain display strings
// (callers map their raw row objects into {key: formattedString} first, same formatting
// already used on screen - e.g. money()/pct()/dt() - so the CSV reads the same as the table).
export interface CsvColumn {
  key: string;
  label: string;
}

function escapeCsvValue(value: unknown): string {
  const str = value == null ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportRowsToCsv(filename: string, columns: CsvColumn[], rows: Record<string, unknown>[]) {
  const header = columns.map((c) => escapeCsvValue(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => escapeCsvValue(row[c.key])).join(','));
  const csv = [header, ...lines].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
