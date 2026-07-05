export interface Throttled<A extends unknown[]> {
  call: (...args: A) => void;
  flush: () => void;
  cancel: () => void;
}

export function throttleTrailing<A extends unknown[]>(
  fn: (...args: A) => void,
  intervalMs: number
): Throttled<A> {
  let lastFire = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const fire = (args: A) => {
    lastFire = Date.now();
    fn(...args);
  };

  const call = (...args: A) => {
    const elapsed = Date.now() - lastFire;
    if (elapsed >= intervalMs && timer === null) {
      fire(args);
      return;
    }
    pending = args;
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        if (pending !== null) {
          const args2 = pending;
          pending = null;
          fire(args2);
        }
      }, Math.max(0, intervalMs - elapsed));
    }
  };

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending !== null) {
      const args = pending;
      pending = null;
      fire(args);
    }
  };

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  };

  return { call, flush, cancel };
}
