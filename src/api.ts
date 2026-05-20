export interface Device {
  name: string;
  id: string;
  state: string;
  type: string;
}

export interface MachineInfo {
  version: string;
  model: string;
  serialNumber: string;
  GHC: boolean;
  extra: Record<string, unknown>;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  devices: () => json<Device[]>('/api/v1/devices'),
  machineInfo: () => json<MachineInfo>('/api/v1/machine/info'),
  requestState: (state: string) =>
    fetch(`/api/v1/machine/state/${encodeURIComponent(state)}`, { method: 'PUT' }),
  tareScale: () => fetch('/api/v1/scale/tare', { method: 'PUT' }),
};
