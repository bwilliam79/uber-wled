import { Children, cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * Accessible overflow menu. Children stay mounted while closed so file inputs
 * inside transfer actions remain in the document.
 */
export function MoreMenu({
  label = 'More',
  name,
  children
}: {
  label?: string;
  /** Accessible name when the visible label is just "More". */
  name?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const menu = rootRef.current?.querySelector<HTMLElement>('[role="menu"]');
    const items = () =>
      Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []).filter(
        (el) => !el.hasAttribute('disabled')
      );
    items()[0]?.focus();

    function close() {
      setOpen(false);
      buttonRef.current?.focus();
    }
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close();
    }
    function onKey(event: KeyboardEvent) {
      if (!rootRef.current?.contains(event.target as Node) && event.target !== buttonRef.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const list = items();
      if (list.length === 0) return;
      event.preventDefault();
      const index = list.indexOf(document.activeElement as HTMLElement);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = index < 0 ? 0 : (index + delta + list.length) % list.length;
      list[next]?.focus();
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="ui-more" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="ui-btn ui-btn-secondary ui-btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={name}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      <div id={menuId} role="menu" hidden={!open} className="ui-more-menu">
        {Children.map(children, (child) =>
          isValidElement(child) ? cloneElement(child, { role: 'menuitem' } as { role: 'menuitem' }) : child
        )}
      </div>
    </div>
  );
}
