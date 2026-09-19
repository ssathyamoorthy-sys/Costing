import { useRef, useState } from 'react';
import { ApiError, openBinary, uploadFile } from '../api';
import { Alert } from './Alert';

interface ImportResult {
  created?: number;
  updated?: number;
  ratesAdded?: number;
  totalRows?: number;
  warnings?: string[];
}

export function ImportExportBar({
  exportUrl,
  exportFilename,
  importUrl,
  canEdit,
  onImported,
}: {
  exportUrl: string;
  exportFilename: string;
  importUrl: string;
  canEdit: boolean;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await uploadFile<ImportResult>(importUrl, file);
      setResult(res);
      onImported();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div className="tag-row">
        <button className="btn" onClick={() => openBinary(exportUrl, exportFilename)}>
          Export to Excel
        </button>
        {canEdit && (
          <>
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? 'Importing...' : 'Import from Excel'}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={handleFile} />
          </>
        )}
      </div>
      {error && <Alert type="error">{error}</Alert>}
      {result && (
        <Alert type="success">
          Imported {result.totalRows ?? 0} row(s): {result.created ?? 0} created, {result.updated ?? 0} updated
          {result.ratesAdded != null ? `, ${result.ratesAdded} new rate(s) approved` : ''}.
          {result.warnings && result.warnings.length > 0 && (
            <ul style={{ margin: '6px 0 0' }}>
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
    </div>
  );
}
