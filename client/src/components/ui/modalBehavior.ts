import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Shared dialog behavior: focus the first focusable element on open, trap
 * Tab inside the panel, close on Escape, restore focus on unmount/close.
 *
 * onClose is read from a ref rather than being an effect dependency.
 * Callers overwhelmingly pass an inline arrow function (`onClose={() =>
 * setOpen(false)}`), which gets a new identity every render of the parent —
 * including re-renders triggered by something unrelated to the modal, like
 * a polling query elsewhere on the page. With onClose in the dependency
 * array, that alone tore down and re-ran this effect: the cleanup restored
 * focus to whatever was focused before the modal opened, then the effect
 * body immediately refocused the panel's first focusable element — yanking
 * focus out of whatever field the user was actively typing into, on every
 * poll tick. The ref keeps the effect's identity tied only to `open`.
 */
export function useModalBehavior(
  panelRef: RefObject<HTMLDivElement | null>,
  open: boolean,
  onClose: () => void
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => !el.hasAttribute('disabled'));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, panelRef]);
}
