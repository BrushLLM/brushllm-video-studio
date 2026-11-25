import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const focusPrevious = (previous) => previous;

// Modal focus management: Escape closes, Tab cycles inside the dialog,
// focus lands inside on open and returns to the trigger on close.
export function useModalFocus(onClose, restoreTarget = focusPrevious) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const previouslyFocused = document.activeElement;

    const focusables = node.querySelectorAll(FOCUSABLE);
    (focusables[0] || node).focus();

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...node.querySelectorAll(FOCUSABLE)].filter(
        (el) => !el.disabled && el.offsetParent !== null
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      const target = restoreTarget(previouslyFocused);
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [onClose, restoreTarget]);

  return ref;
}
