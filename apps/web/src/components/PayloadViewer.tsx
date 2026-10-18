import { useState } from 'react';

export function PayloadViewer({ payload }: { payload: unknown }) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(payload, null, 2);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  }
  return (
    <div className="payload">
      <button type="button" className="btn btn-ghost copy" onClick={copy}>
        {copied ? 'Copiado' : 'Copiar'}
      </button>
      <pre>{text}</pre>
    </div>
  );
}
