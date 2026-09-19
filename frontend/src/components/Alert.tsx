import type { ReactNode } from 'react';

export function Alert({ type, children }: { type: 'error' | 'warning' | 'success'; children: ReactNode }) {
  return <div className={`alert ${type}`}>{children}</div>;
}
