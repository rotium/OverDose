import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import type { GatewayShotSummary, ShotListParams } from '../api';

// uPlot doesn't render under jsdom — the chart isn't the subject here.
vi.mock('./ShotMiniChart', () => ({
  ShotMiniChart: () => <div data-testid="shot-mini-chart-stub" />,
}));

import { ShotHistoryScreen } from './ShotHistoryScreen';

const mk = (
  id: string,
  ts: string,
  over: {
    profile?: string;
    coffee?: string;
    grinder?: string;
    enjoyment?: number;
    actualYield?: number;
  } = {},
): GatewayShotSummary => ({
  id,
  timestamp: ts,
  workflow: {
    name: 'Morning',
    profile: { title: over.profile ?? 'Decent Default' },
    context: {
      coffeeName: over.coffee ?? 'Ethiopia Guji',
      grinderModel: over.grinder,
      targetDoseWeight: 18,
      targetYield: 36,
    },
  },
  annotations:
    over.enjoyment !== undefined || over.actualYield !== undefined
      ? {
          ...(over.enjoyment !== undefined ? { enjoyment: over.enjoyment } : {}),
          ...(over.actualYield !== undefined
            ? { actualYield: over.actualYield }
            : {}),
        }
      : undefined,
});

const today = new Date();
const iso = (h: number) => {
  const d = new Date(today);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};

const setup = (
  opts: {
    pages?: Array<{ items: GatewayShotSummary[]; total: number }>;
    fetchShots?: (p: ShotListParams) => Promise<{
      items: GatewayShotSummary[];
      total: number;
    }>;
    beans?: string[];
  } = {},
) => {
  const calls: ShotListParams[] = [];
  const pages = opts.pages ?? [
    { items: [mk('a', iso(9)), mk('b', iso(8))], total: 2 },
  ];
  let call = 0;
  const fetchShots =
    opts.fetchShots ??
    ((p: ShotListParams) => {
      calls.push(p);
      const page = pages[Math.min(call, pages.length - 1)]!;
      call++;
      return Promise.resolve(page);
    });
  const onClose = vi.fn();
  render(() => (
    <ShotHistoryScreen
      onClose={onClose}
      fetchShots={fetchShots}
      fetchBeans={() =>
        Promise.resolve(
          (opts.beans ?? []).map(
            (name, i) => ({ id: `b${i}`, roaster: 'R', name }) as never,
          ),
        )
      }
      fetchProfiles={() => Promise.resolve([])}
      fetchShot={(id) =>
        Promise.resolve({ ...mk(id, iso(9)), measurements: [] })
      }
      updateShot={() => Promise.resolve()}
      deleteShot={() => Promise.resolve()}
    />
  ));
  return { calls, onClose };
};

describe('ShotHistoryScreen', () => {
  it('lists shots with a count and a day-group header', async () => {
    setup();
    await waitFor(() =>
      expect(screen.getAllByTestId('shot-row')).toHaveLength(2),
    );
    expect(screen.getByTestId('shot-history-count')).toHaveTextContent('2 shots');
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('labels an ad-hoc shot (no recipe name) by its profile, not a placeholder', async () => {
    const adhoc: GatewayShotSummary = {
      id: 'x',
      timestamp: iso(9),
      workflow: {
        // No `name` — an Explore/ad-hoc brew carries no recipe.
        profile: { title: 'Tea portafilter/Oolong', beverage_type: 'pourover' },
        context: { coffeeName: 'Oolong' },
      },
    };
    setup({ pages: [{ items: [adhoc], total: 1 }] });
    await waitFor(() =>
      expect(screen.getByTestId('shot-row')).toBeInTheDocument(),
    );
    const row = screen.getByTestId('shot-row');
    // Type leads (from beverage_type), profile beneath — not "Espresso".
    expect(row).toHaveTextContent('Pourover');
    expect(row).toHaveTextContent('Tea portafilter/Oolong');
    expect(row).not.toHaveTextContent('Espresso');
  });

  it('shows an empty state when there are no shots', async () => {
    setup({ pages: [{ items: [], total: 0 }] });
    await waitFor(() =>
      expect(screen.getByTestId('shot-history-empty')).toHaveTextContent(
        /no shots match/i,
      ),
    );
  });

  it('debounces search into the fetch query', async () => {
    const { calls } = setup();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    fireEvent.input(screen.getByTestId('shot-history-search'), {
      target: { value: 'guji' },
    });
    await waitFor(() =>
      expect(calls.some((c) => c.search === 'guji')).toBe(true),
    );
  });

  it('appends the next page on Load more', async () => {
    setup({
      pages: [
        { items: [mk('a', iso(9)), mk('b', iso(8))], total: 3 },
        { items: [mk('c', iso(7))], total: 3 },
      ],
    });
    await waitFor(() =>
      expect(screen.getAllByTestId('shot-row')).toHaveLength(2),
    );
    fireEvent.click(screen.getByTestId('shot-history-load-more'));
    await waitFor(() =>
      expect(screen.getAllByTestId('shot-row')).toHaveLength(3),
    );
  });

  it('opens detail on row click and returns on back', async () => {
    setup();
    await waitFor(() =>
      expect(screen.getAllByTestId('shot-row')).toHaveLength(2),
    );
    fireEvent.click(screen.getAllByTestId('shot-row')[0]);
    await waitFor(() =>
      expect(screen.getByTestId('shot-detail-view')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('shot-detail-back'));
    await waitFor(() =>
      expect(screen.getByTestId('shot-history-list')).toBeInTheDocument(),
    );
  });

  it('reflects a saved edit in the list row without a refetch', async () => {
    setup();
    await waitFor(() =>
      expect(screen.getAllByTestId('shot-row')).toHaveLength(2),
    );
    // Both rows start at the 18 g target dose.
    expect(screen.getAllByTestId('shot-row')[0]).toHaveTextContent('18.0 g');

    fireEvent.click(screen.getAllByTestId('shot-row')[0]);
    await waitFor(() =>
      expect(screen.getByTestId('shot-detail-view')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('shot-detail-edit'));
    const dose = screen.getByTestId('shot-detail-dose-input');
    fireEvent.input(dose, { target: { value: '20' } });
    fireEvent.blur(dose);
    fireEvent.click(screen.getByTestId('shot-detail-save'));
    await waitFor(() =>
      expect(screen.getByTestId('shot-detail-edit')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('shot-detail-back'));

    await waitFor(() =>
      expect(screen.getAllByTestId('shot-row')[0]).toHaveTextContent('20.0 g'),
    );
  });

  it('partial-searches the bean dropdown, then filters by name + roaster', async () => {
    const { calls } = setup({ beans: ['Ethiopia Guji'] }); // roaster seeded as "R"
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId('shot-history-filters'));
    const beanField = screen.getByTestId('shot-filter-bean');
    // Type a partial term — the dropdown filters to the matching bean…
    fireEvent.input(beanField, { target: { value: 'ethiop' } });
    const option = await screen.findByTestId('shot-filter-bean-option-0');
    // …and selecting it commits the exact bean (name + roaster).
    fireEvent.mouseDown(option);
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.coffeeName === 'Ethiopia Guji' && c.coffeeRoaster === 'R',
        ),
      ).toBe(true),
    );
    const chip = await screen.findByTestId('shot-history-chip-coffee');
    expect(chip).toHaveTextContent('Ethiopia Guji');
    fireEvent.click(chip);
    await waitFor(() =>
      expect(screen.queryByTestId('shot-history-chip-coffee')).toBeNull(),
    );
  });

  it('closes the screen via Back', async () => {
    const { onClose } = setup();
    await waitFor(() =>
      expect(screen.getAllByTestId('shot-row')).toHaveLength(2),
    );
    fireEvent.click(screen.getByTestId('shot-history-back'));
    expect(onClose).toHaveBeenCalled();
  });

  describe('row identity', () => {
    const rowOf = async (s: GatewayShotSummary): Promise<HTMLElement> => {
      setup({ pages: [{ items: [s], total: 1 }] });
      return waitFor(() => screen.getByTestId('shot-row'));
    };
    // Brew column is the first .shot-row__col, bean column the second.
    const cols = (row: HTMLElement): HTMLElement[] =>
      Array.from(row.querySelectorAll('.shot-row__col'));

    it('recipe shot: recipe primary + profile muted; bean and dose→yield', async () => {
      const [brew, bean] = cols(
        await rowOf(mk('a', iso(9), { enjoyment: 80, actualYield: 36 })),
      );
      expect(brew).toHaveTextContent('Morning'); // recipe
      expect(brew).toHaveTextContent('Decent Default'); // profile, muted
      expect(bean).toHaveTextContent('Ethiopia Guji');
      const row = screen.getByTestId('shot-row');
      expect(row).toHaveTextContent('18.0 g'); // dose
      expect(row).toHaveTextContent('36.0 g'); // real recorded yield
    });

    it('keeps the arrow but blanks the yield when none is recorded', async () => {
      // No actualYield → no measured result; must not fall back to the target,
      // but the "dose →" pairing (with the arrow) stays.
      const row = await rowOf(mk('a', iso(9)));
      const metric = row.querySelector('.shot-row__yield')!;
      expect(metric).toHaveTextContent('18.0 g'); // dose
      expect(metric).toHaveTextContent('→'); // arrow kept
      expect(metric).not.toHaveTextContent('36'); // target yield not shown
    });

    it('drops the arrow entirely when neither dose nor yield is present', async () => {
      const row = await rowOf({
        id: 'x',
        timestamp: iso(9),
        workflow: { profile: { title: 'P' }, context: {} },
      });
      expect(row.querySelector('.shot-row__yield')).not.toHaveTextContent('→');
    });

    it('bean column shows the roaster as a muted second line', async () => {
      const [, bean] = cols(
        await rowOf({
          id: 's',
          timestamp: iso(9),
          workflow: {
            name: 'Morning',
            profile: { title: 'Decent Default' },
            context: { coffeeName: 'Geisha', coffeeRoaster: 'Onyx' },
          },
        }),
      );
      expect(bean).toHaveTextContent('Geisha');
      expect(bean).toHaveTextContent('Onyx');
    });

    it('shows "No bean" when the shot has no coffee', async () => {
      const [, bean] = cols(
        await rowOf({
          id: 's',
          timestamp: iso(9),
          workflow: { name: 'Morning', profile: { title: 'X' }, context: {} },
        }),
      );
      expect(bean).toHaveTextContent('No bean');
    });

    it('no recipe + no type: profile title is the primary, no muted line', async () => {
      const [brew] = cols(
        await rowOf({
          id: 's',
          timestamp: iso(9),
          workflow: { profile: { title: 'My Profile' }, context: { coffeeName: 'X' } },
        }),
      );
      expect(brew).toHaveTextContent('My Profile');
      expect(brew.querySelector('.shot-row__secondary')).toBeNull();
    });

    it('falls back to "Shot" with no recipe, type, or profile title', async () => {
      const [brew] = cols(
        await rowOf({ id: 's', timestamp: iso(9), workflow: { context: {} } }),
      );
      expect(brew).toHaveTextContent('Shot');
    });

    it('renders the shot clock time in its own column', async () => {
      await rowOf(mk('a', iso(9)));
      const time = screen
        .getByTestId('shot-row')
        .querySelector('.shot-row__time');
      expect(time?.textContent).toMatch(/\d{1,2}:\d{2}/);
    });
  });
});
