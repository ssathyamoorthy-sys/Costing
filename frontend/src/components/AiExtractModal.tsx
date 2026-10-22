import { useState } from 'react';
import { Modal } from './Modal';
import { Alert } from './Alert';
import { aiExtractQuote, ApiError } from '../api';
import type { ExtractionResult } from '../types';

export function AiExtractModal({
  quoteId,
  onClose,
  onExtracted,
}: {
  quoteId?: number;
  onClose: () => void;
  onExtracted: (result: ExtractionResult) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [emailText, setEmailText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!file && !emailText.trim()) {
      setError('Upload a screenshot/Excel file, or paste some text, to extract from.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await aiExtractQuote({ file: file ?? undefined, emailText: emailText.trim() || undefined, quoteId });
      onExtracted(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'AI extraction failed - try again, or enter the quote manually.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Create from file / email (AI)" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Upload a screenshot or Excel/CSV spec sheet, or paste an email/WhatsApp inquiry below. The AI will propose a
        quote draft for you to review and correct before saving - nothing is saved automatically.
      </p>

      {error && <Alert type="error">{error}</Alert>}

      <div className="form-grid">
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Screenshot or Excel/CSV file</label>
          <input
            type="file"
            accept="image/*,.xlsx,.xls,.csv"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              if (e.target.files?.[0]) setEmailText('');
            }}
          />
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Or paste email / WhatsApp text</label>
          <textarea
            rows={5}
            disabled={busy}
            value={emailText}
            onChange={(e) => {
              setEmailText(e.target.value);
              if (e.target.value) setFile(null);
            }}
            placeholder="Paste the customer's inquiry text here..."
          />
        </div>
      </div>

      <div className="modal-actions">
        <button className="btn" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy} onClick={submit}>
          {busy ? 'Analyzing with AI… this can take 10-30s' : 'Extract'}
        </button>
      </div>
    </Modal>
  );
}
