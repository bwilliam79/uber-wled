import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { listControllers, getFirmwareStatus, type Controller } from './client';

export function useControllers(): UseQueryResult<Controller[]> {
  return useQuery({ queryKey: ['controllers'], queryFn: listControllers });
}

const FIRMWARE_CHECK_INTERVAL_MS = 60_000;

/**
 * True when any controller reports an available firmware update.
 * Best-effort: unreachable controllers are ignored; errors keep the last value.
 */
export function useFirmwareUpdateAvailable(): boolean {
  const query = useQuery({
    queryKey: ['firmware-update-available'],
    queryFn: async () => {
      const controllers = await listControllers();
      const statuses = await Promise.all(
        controllers.map((c) => getFirmwareStatus(c.id).catch(() => null))
      );
      return statuses.some((s) => s?.updateAvailable);
    },
    refetchInterval: FIRMWARE_CHECK_INTERVAL_MS
  });
  return query.data ?? false;
}
