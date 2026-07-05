import { QueryClient } from '@tanstack/react-query';

/**
 * Single source of react-query defaults. The app is LAN-only and mostly
 * polling-driven, so window-focus refetches are noise; 15s staleTime keeps
 * section switches instant without hammering controllers.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        retry: 1
      }
    }
  });
}
