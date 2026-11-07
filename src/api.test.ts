import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, enjoymentFromGateway, enjoymentToGateway } from './api';
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

  describe('enjoyment scale (UI 0–100 ↔ Decaid 0–10)', () => {
    it('enjoymentToGateway scales down to one decimal and clamps', () => {
      expect(enjoymentToGateway(0)).toBe(0);
      expect(enjoymentToGateway(75)).toBe(7.5);
      expect(enjoymentToGateway(100)).toBe(10);
      expect(enjoymentToGateway(62.4)).toBe(6.2);
      expect(enjoymentToGateway(130)).toBe(10);
      expect(enjoymentToGateway(-5)).toBe(0);
    });

    it('enjoymentFromGateway scales 0–10 up, and keeps legacy 0–100 values', () => {
      expect(enjoymentFromGateway(0)).toBe(0);
      expect(enjoymentFromGateway(7.5)).toBe(75);
      expect(enjoymentFromGateway(10)).toBe(100);
      // A pre-0.8.7 gateway never migrated, so it can still hold 0–100.
      expect(enjoymentFromGateway(80)).toBe(80);
      expect(enjoymentFromGateway(250)).toBe(100);
    });

    it('shotsLatest, shotById and shotsList return ratings on the UI scale', async () => {
      const shot = { id: 'a', timestamp: '', annotations: { enjoyment: 7.5, espressoNotes: 'x' } };
      fetchMock.mockResolvedValueOnce(ok(shot));
      expect((await api.shotsLatest()).annotations).toEqual({ enjoyment: 75, espressoNotes: 'x' });
      fetchMock.mockResolvedValueOnce(ok({ ...shot, measurements: [] }));
      expect((await api.shotById('a')).annotations?.enjoyment).toBe(75);
      fetchMock.mockResolvedValueOnce(
        ok({ items: [shot, { id: 'b', timestamp: '' }], total: 2, limit: 20, offset: 0 }),
      );
      const page = await api.shotsList();
      expect(page.items[0]!.annotations?.enjoyment).toBe(75);
      expect(page.items[1]!.annotations).toBeUndefined();
    });

    it('updateShot and updateShotAnnotations send the rating on the 0–10 scale', async () => {
      await api.updateShot('a', {
        annotations: { enjoyment: 75, espressoNotes: 'n' },
        workflow: { context: { coffeeName: 'X' } },
      });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        annotations: { enjoyment: 7.5, espressoNotes: 'n' },
        workflow: { context: { coffeeName: 'X' } },
      });
      await api.updateShotAnnotations('a', { enjoyment: 100 });
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
        annotations: { enjoyment: 10 },
      });
    });

    it('leaves a patch without a rating untouched', async () => {
      await api.updateShot('a', { annotations: { espressoNotes: 'n' } });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        annotations: { espressoNotes: 'n' },
      });
    });
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
