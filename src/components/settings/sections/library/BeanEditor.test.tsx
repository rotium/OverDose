import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { BeanEditor } from './BeanEditor';
import type { Bean, BeanPatch } from '../../../../api';

const mkBean = (over: Partial<Bean> = {}): Bean => ({
  id: 'b1',
  roaster: 'Square Mile',
  name: 'Red Brick',
  decaf: false,
  archived: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

/** In-memory bean the editor reads/writes through, so refetch sees saves. */
const emptyShotsPage = { items: [], total: 0, limit: 100, offset: 0 };

const makeFake = (initial: Bean) => {
  let bean: Bean = { ...initial };
  return {
    loadBean: vi.fn(async () => ({ ...bean })),
    saveBean: vi.fn(async (_id: string, patch: BeanPatch) => {
      bean = { ...bean, ...patch } as Bean;
    }),
    // Default: no shots. Tests that exercise the derived rating pass their own.
    loadShots: vi.fn(async () => ({ ...emptyShotsPage })),
    current: () => bean,
  };
};

const renderEditor = (
  fake: ReturnType<typeof makeFake>,
  onClose = vi.fn(),
  existing?: Record<string, string[]>,
) => {
  render(() => (
    <BeanEditor
      beanId="b1"
      onClose={onClose}
      loadBean={fake.loadBean}
      saveBean={fake.saveBean}
      loadShots={fake.loadShots}
      existing={existing}
      debounceMs={0}
    />
  ));
  return { onClose };
};

describe('BeanEditor', () => {
  it('renders the identity fields', async () => {
    const fake = makeFake(mkBean());
    renderEditor(fake);
    await waitFor(() => screen.getByTestId('bean-editor'));
    expect(
      (screen.getByTestId('bean-roaster-input') as HTMLInputElement).value,
    ).toBe('Square Mile');
    expect(
      (screen.getByTestId('bean-name-input') as HTMLInputElement).value,
    ).toBe('Red Brick');
  });

  it('persists an edited name as a sparse patch', async () => {
    const fake = makeFake(mkBean());
    renderEditor(fake);
    const name = (await waitFor(() =>
      screen.getByTestId('bean-name-input'),
    )) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Sweetshop' } });
    await waitFor(() => expect(fake.saveBean).toHaveBeenCalled());
    expect(fake.saveBean).toHaveBeenCalledWith('b1', { name: 'Sweetshop' });
  });

  it('clears the decaf process when decaf is turned off', async () => {
    const fake = makeFake(mkBean({ decaf: true, decafProcess: 'Swiss Water' }));
    renderEditor(fake);
    const toggle = (await waitFor(() =>
      screen.getByTestId('bean-decaf-toggle'),
    )) as HTMLInputElement;
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(fake.saveBean).toHaveBeenCalledWith('b1', {
        decaf: false,
        decafProcess: '',
      }),
    );
  });

  it('adds a variety chip', async () => {
    const fake = makeFake(mkBean());
    renderEditor(fake);
    const input = (await waitFor(() =>
      screen.getByTestId('bean-variety-input'),
    )) as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'Bourbon' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(fake.saveBean).toHaveBeenCalledWith('b1', { variety: ['Bourbon'] }),
    );
  });

  it('suggests varieties used on other beans and adds the picked one', async () => {
    const fake = makeFake(mkBean({ variety: ['Bourbon'] }));
    render(() => (
      <BeanEditor
        beanId="b1"
        onClose={vi.fn()}
        loadBean={fake.loadBean}
        saveBean={fake.saveBean}
        loadShots={fake.loadShots}
        existing={{ variety: ['Bourbon', 'Catuaí', 'Gesha'] }}
        debounceMs={0}
      />
    ));
    const input = (await waitFor(() =>
      screen.getByTestId('bean-variety-input'),
    )) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: 'ge' } });
    const option = await waitFor(() =>
      screen.getByTestId('bean-variety-input-option-0'),
    );
    // 'Bourbon' is already on the bean, so it's excluded; 'ge' matches Gesha.
    expect(option.textContent).toBe('Gesha');
    fireEvent.mouseDown(option);
    await waitFor(() =>
      expect(fake.saveBean).toHaveBeenCalledWith('b1', {
        variety: ['Bourbon', 'Gesha'],
      }),
    );
  });

  it('archives via the checkbox without closing the editor', async () => {
    const fake = makeFake(mkBean());
    const { onClose } = renderEditor(fake);
    const toggle = (await waitFor(() =>
      screen.getByTestId('bean-archive-toggle'),
    )) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(fake.saveBean).toHaveBeenCalledWith('b1', { archived: true }),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('permanently deletes the bean after confirming, and closes', async () => {
    const fake = makeFake(mkBean());
    const deleteBean = vi.fn(async () => {});
    const onClose = vi.fn();
    render(() => (
      <BeanEditor
        beanId="b1"
        onClose={onClose}
        loadBean={fake.loadBean}
        saveBean={fake.saveBean}
        loadShots={fake.loadShots}
        deleteBean={deleteBean}
        debounceMs={0}
      />
    ));
    fireEvent.click(await waitFor(() => screen.getByTestId('delete-bean-button')));
    fireEvent.click(
      await waitFor(() => screen.getByTestId('confirm-delete-bean-button')),
    );
    await waitFor(() => expect(deleteBean).toHaveBeenCalledWith('b1'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('unchecking the archive toggle restores, and stays open', async () => {
    const fake = makeFake(mkBean({ archived: true }));
    const { onClose } = renderEditor(fake);
    const toggle = (await waitFor(() =>
      screen.getByTestId('bean-archive-toggle'),
    )) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(fake.saveBean).toHaveBeenCalledWith('b1', { archived: false }),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('suggests existing roasters and commits the picked one', async () => {
    const fake = makeFake(mkBean({ roaster: '' }));
    renderEditor(fake, vi.fn(), {
      roaster: ['Has Bean', 'Onyx', 'Square Mile'],
    });
    const input = (await waitFor(() =>
      screen.getByTestId('bean-roaster-input'),
    )) as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'Squ' } });
    const option = await waitFor(() =>
      screen.getByTestId('bean-roaster-input-option-0'),
    );
    expect(option.textContent).toBe('Square Mile');
    fireEvent.mouseDown(option);
    await waitFor(() =>
      expect(fake.saveBean).toHaveBeenCalledWith('b1', {
        roaster: 'Square Mile',
      }),
    );
  });

  it('clears an optional field to empty (gateway null-revert stopgap)', async () => {
    const fake = makeFake(mkBean({ country: 'Brazil' }));
    renderEditor(fake);
    const country = (await waitFor(() =>
      screen.getByTestId('bean-country-input'),
    )) as HTMLInputElement;
    fireEvent.focus(country);
    fireEvent.input(country, { target: { value: '' } });
    fireEvent.blur(country);
    await waitFor(() =>
      expect(fake.saveBean).toHaveBeenCalledWith('b1', { country: '' }),
    );
  });

  it('clears species through the autocomplete', async () => {
    const fake = makeFake(mkBean({ species: 'Arabica' }));
    renderEditor(fake);
    const input = (await waitFor(() =>
      screen.getByTestId('bean-species-input'),
    )) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: '' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(fake.saveBean).toHaveBeenCalledWith('b1', { species: '' }),
    );
  });

  it('accepts a free-text species not in the predefined list', async () => {
    const fake = makeFake(mkBean({ species: '' }));
    renderEditor(fake);
    const input = (await waitFor(() =>
      screen.getByTestId('bean-species-input'),
    )) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: 'Eugenioides' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(fake.saveBean).toHaveBeenCalledWith('b1', {
        species: 'Eugenioides',
      }),
    );
  });

  it('suggests processing values already used on other beans', async () => {
    const fake = makeFake(mkBean());
    render(() => (
      <BeanEditor
        beanId="b1"
        onClose={vi.fn()}
        loadBean={fake.loadBean}
        saveBean={fake.saveBean}
        loadShots={fake.loadShots}
        existing={{ processing: ['Carbonic Maceration'] }}
        debounceMs={0}
      />
    ));
    const input = (await waitFor(() =>
      screen.getByTestId('bean-processing-input'),
    )) as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'carb' } });
    const option = await waitFor(() =>
      screen.getByTestId('bean-processing-input-option-0'),
    );
    expect(option.textContent).toBe('Carbonic Maceration');
  });

  it('persists a tapped rating into extras', async () => {
    const fake = makeFake(mkBean());
    renderEditor(fake);
    // tier-4 = the "Good" preset (75) on the 0/25/50/75/100 scale.
    fireEvent.click(await waitFor(() => screen.getByTestId('bean-rating-tier-4')));
    await waitFor(() =>
      expect(fake.saveBean).toHaveBeenCalledWith('b1', {
        extras: { rating: 75 },
      }),
    );
  });

  it('preserves existing extras keys when rating', async () => {
    const fake = makeFake(mkBean({ extras: { beanId: 'src-1' } }));
    renderEditor(fake);
    fireEvent.click(await waitFor(() => screen.getByTestId('bean-rating-tier-5')));
    await waitFor(() =>
      expect(fake.saveBean).toHaveBeenCalledWith('b1', {
        extras: { beanId: 'src-1', rating: 100 },
      }),
    );
  });

  it('coalesces rapid rating changes into a single debounced save', async () => {
    const fake = makeFake(mkBean());
    renderEditor(fake); // debounceMs={0}
    fireEvent.click(await waitFor(() => screen.getByTestId('bean-rating-tier-3'))); // 50
    fireEvent.click(screen.getByTestId('bean-rating-tier-5')); // 100
    await waitFor(() =>
      expect(fake.saveBean).toHaveBeenCalledWith('b1', { extras: { rating: 100 } }),
    );
    // Only the settled value is persisted — the intermediate 50 is dropped.
    expect(fake.saveBean).toHaveBeenCalledTimes(1);
  });

  it('shows the derived rating averaged from the bean\'s shots', async () => {
    const fake = makeFake(mkBean());
    fake.loadShots.mockResolvedValueOnce({
      items: [
        { id: 's1', timestamp: '', annotations: { enjoyment: 80 } },
        { id: 's2', timestamp: '', annotations: { enjoyment: 60 } },
        { id: 's3', timestamp: '', annotations: {} }, // unrated — ignored
      ],
      total: 312, // > 100 → windowed, so "recent"
      limit: 100,
      offset: 0,
    } as never);
    renderEditor(fake);
    const readout = await waitFor(() => screen.getByTestId('bean-recent-shots'));
    // mean of 80 & 60 = 70 over 2 rated; windowed → "recent"; no lifetime total.
    await waitFor(() =>
      expect(readout.textContent).toContain('70 · avg of 2 recent ratings'),
    );
    expect(readout.textContent).not.toContain('total');
    // queried by the bean's denormalized name + roaster.
    expect(fake.loadShots).toHaveBeenCalledWith(
      expect.objectContaining({ coffeeName: 'Red Brick', coffeeRoaster: 'Square Mile' }),
    );
  });

  it('uses singular, non-windowed wording for a single rating within all shots', async () => {
    const fake = makeFake(mkBean());
    fake.loadShots.mockResolvedValueOnce({
      items: [{ id: 's1', timestamp: '', annotations: { enjoyment: 78 } }],
      total: 27, // <= 100 → all shots seen, so no "recent"
      limit: 100,
      offset: 0,
    } as never);
    renderEditor(fake);
    const readout = await waitFor(() => screen.getByTestId('bean-recent-shots'));
    await waitFor(() =>
      expect(readout.textContent).toContain('78 · from 1 rating'),
    );
    expect(readout.textContent).not.toContain('recent');
  });

  it('shows "No rated shots yet" and no summary echo when there are no rated shots', async () => {
    const fake = makeFake(mkBean()); // default loadShots → empty page
    renderEditor(fake);
    const readout = await waitFor(() => screen.getByTestId('bean-recent-shots'));
    await waitFor(() => expect(readout.textContent).toContain('No rated shots yet'));
  });

  it('surfaces an inline error when a save fails', async () => {
    const fake = makeFake(mkBean());
    fake.saveBean.mockRejectedValueOnce(new Error('offline'));
    renderEditor(fake);
    const name = (await waitFor(() =>
      screen.getByTestId('bean-name-input'),
    )) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Sweetshop' } });
    await waitFor(() => screen.getByTestId('bean-save-error'));
  });
});
