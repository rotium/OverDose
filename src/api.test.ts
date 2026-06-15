import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import type { ShotSettingsSnapshot } from './snapshot';

const ok = (body: unknown = {}, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('api', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(ok()));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('requestState issues PUT to /api/v1/machine/state/{state}', async () => {
    await api.requestState('sleeping');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/machine/state/sleeping',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('sleep() delegates to requestState("sleeping")', async () => {
    await api.sleep();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/machine/state/sleeping',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('updateShotSettings POSTs the full body', async () => {
    const settings: ShotSettingsSnapshot = {
      steamSetting: 0,
      targetSteamTemp: 145,
      targetSteamDuration: 30,
      targetHotWaterTemp: 95,
      targetHotWaterVolume: 120,
      targetHotWaterDuration: 30,
      targetShotVolume: 36,
      groupTemp: 93,
    };
    await api.updateShotSettings(settings);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/machine/shotSettings');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(settings);
  });

  it('shotsLatest fetches /api/v1/shots/latest', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'abc', timestamp: '2026-05-22T08:00:00Z' }));
    const result = await api.shotsLatest();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/shots/latest', undefined);
    expect(result.id).toBe('abc');
  });

  it('shotById URL-encodes the id', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'a/b', timestamp: '', measurements: [] }));
    await api.shotById('a/b');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/shots/a%2Fb', undefined);
  });

  it('shotsList defaults limit/offset/order and omits empty filters', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ items: [], total: 0, limit: 20, offset: 0 }),
    );
    await api.shotsList();
    const [path] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/shots?limit=20&offset=0&order=desc');
  });

  it('shotsList serializes filters and pagination', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ items: [], total: 0, limit: 50, offset: 50 }),
    );
    await api.shotsList({
      limit: 50,
      offset: 50,
      search: 'guji',
      coffeeName: 'Ethiopia Guji',
      profileTitle: 'Decent Default',
      grinderModel: 'Niche Zero',
      order: 'asc',
    });
    const url = new URL(`http://x${fetchMock.mock.calls[0][0]}`);
    expect(url.pathname).toBe('/api/v1/shots');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('offset')).toBe('50');
    expect(url.searchParams.get('order')).toBe('asc');
    expect(url.searchParams.get('search')).toBe('guji');
    expect(url.searchParams.get('coffeeName')).toBe('Ethiopia Guji');
    expect(url.searchParams.get('profileTitle')).toBe('Decent Default');
    expect(url.searchParams.get('grinderModel')).toBe('Niche Zero');
  });

  it('deleteShot issues a DELETE with an encoded id', async () => {
    await api.deleteShot('a/b');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/shots/a%2Fb',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('throws when the gateway responds non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    await expect(api.shotsLatest()).rejects.toThrow(/500/);
  });

  it('tareScale issues a PUT', async () => {
    await api.tareScale();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/scale/tare',
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});
