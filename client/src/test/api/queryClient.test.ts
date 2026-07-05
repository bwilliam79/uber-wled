import { describe, it, expect } from 'vitest';
import { createQueryClient } from '../../api/queryClient';

describe('createQueryClient', () => {
  it('sets LAN-friendly defaults: no focus refetch, 15s staleTime, single retry', () => {
    const qc = createQueryClient();
    const defaults = qc.getDefaultOptions().queries;
    expect(defaults?.refetchOnWindowFocus).toBe(false);
    expect(defaults?.staleTime).toBe(15_000);
    expect(defaults?.retry).toBe(1);
  });
});
