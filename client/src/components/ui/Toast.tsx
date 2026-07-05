import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from '../icons';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: 'info' | 'success' | 'error';
  /** ms; default 4000; 0 = sticky until dismissed. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastApi {
  show: (opts: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const DEFAULT_DURATION_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((opts: ToastOptions) => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((prev) => [...prev, { ...opts, id }]);
    const duration = opts.duration ?? DEFAULT_DURATION_MS;
    if (duration > 0) setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="ui-toast-stack" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`ui-toast ui-toast-${t.variant ?? 'info'}`}>
              <div className="ui-toast-content">
                <div className="ui-toast-title">{t.title}</div>
                {t.description && <div className="ui-toast-desc">{t.description}</div>}
                {t.action && (
                  <button
                    type="button"
                    className="ui-toast-action"
                    onClick={() => {
                      t.action!.onClick();
                      dismiss(t.id);
                    }}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button type="button" className="ui-toast-dismiss" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
                <XIcon />
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}
