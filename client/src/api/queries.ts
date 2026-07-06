import { useMemo } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import {
  listControllers, listGroups, listThemes, listSchedules, listCalendarEvents,
  getControllerStatus, getFirmwareStatus, getSettings,
  getCapabilities, listDevicePresets, getControllerConfig, getControllerSegments,
  listStrips, listRoomLabels,
  type Controller, type Group, type CustomTheme, type ControllerStatus,
  type Schedule, type CalendarEvent, type Settings, type FirmwareStatus,
  type ControllerCapabilities, type DevicePreset, type Strip, type RoomLabel
} from './client';

export function useControllers(): UseQueryResult<Controller[]> {
  return useQuery({ queryKey: ['controllers'], queryFn: listControllers });
}

export function useGroups(): UseQueryResult<Group[]> {
  return useQuery({ queryKey: ['groups'], queryFn: listGroups });
}

export function useThemes(): UseQueryResult<CustomTheme[]> {
  return useQuery({ queryKey: ['themes'], queryFn: listThemes });
}

export function useControllerStatuses(): UseQueryResult<Map<string, ControllerStatus>> {
  return useQuery({
    queryKey: ['status'],
    queryFn: async (): Promise<Map<string, ControllerStatus>> => {
      const controllers = await listControllers();
      const statuses = await Promise.all(
        controllers.map((c) =>
          getControllerStatus(c.id).catch(
            (): ControllerStatus => ({ controllerId: c.id, reachable: false, info: null, state: null, polledAt: null })
          )
        )
      );
      return new Map(statuses.map((s) => [s.controllerId, s]));
    },
    refetchInterval: 60_000
  });
}

export function useSchedules(): UseQueryResult<Schedule[]> {
  return useQuery({ queryKey: ['schedules'], queryFn: listSchedules });
}

export function useCalendarEvents(): UseQueryResult<CalendarEvent[]> {
  return useQuery({ queryKey: ['calendarEvents'], queryFn: listCalendarEvents });
}

export function useSettings(): UseQueryResult<Settings> {
  return useQuery({ queryKey: ['settings'], queryFn: getSettings });
}

export function useFirmwareStatus(controllerId: string): UseQueryResult<FirmwareStatus> {
  return useQuery({ queryKey: ['firmware', controllerId], queryFn: () => getFirmwareStatus(controllerId) });
}

export function useCapabilities(controllerId: string | null): UseQueryResult<ControllerCapabilities> {
  return useQuery({
    queryKey: ['capabilities', controllerId],
    queryFn: () => getCapabilities(controllerId as string),
    enabled: controllerId !== null,
    staleTime: 5 * 60_000
  });
}

export function useCapabilitiesMap(controllerIds: string[]): Map<string, ControllerCapabilities> {
  const results = useQueries({
    queries: controllerIds.map((id) => ({
      queryKey: ['capabilities', id],
      queryFn: () => getCapabilities(id),
      staleTime: 5 * 60_000
    }))
  });
  // Stable identity: rebuild the Map only when an underlying result actually
  // updates (dataUpdatedAt moves) or the id list changes. A fresh Map every
  // render fed effect dependencies downstream (ControlSurface) and caused an
  // infinite render loop.
  const signature = controllerIds.join(',') + '|' + results.map((r) => r.dataUpdatedAt).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const map = new Map<string, ControllerCapabilities>();
    results.forEach((r, i) => {
      if (r.data) map.set(controllerIds[i], r.data);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}

export function useDevicePresets(controllerId: string | null): UseQueryResult<DevicePreset[]> {
  return useQuery({
    queryKey: ['presets', controllerId],
    queryFn: () => listDevicePresets(controllerId as string),
    enabled: controllerId !== null
  });
}

const FIRMWARE_CHECK_INTERVAL_MS = 60_000;

export const useDeviceConfig = (controllerId: string) =>
  useQuery({ queryKey: ['config', controllerId], queryFn: () => getControllerConfig(controllerId) });

export const useDeviceSegments = (controllerId: string) =>
  useQuery({ queryKey: ['segments', controllerId], queryFn: () => getControllerSegments(controllerId) });

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

export function useStrips(): UseQueryResult<Strip[]> {
  return useQuery({ queryKey: ['strips'], queryFn: listStrips });
}

export function useRoomLabels(): UseQueryResult<RoomLabel[]> {
  return useQuery({ queryKey: ['room-labels'], queryFn: listRoomLabels });
}
