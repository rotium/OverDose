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
const makeFake = (initial: Bean) => {
  let bean: Bean = { ...initial };
  return {
    loadBean: vi.fn(async () => ({ ...bean })),
    saveBean: vi.fn(async (_id: string, patch: BeanPatch) => {
      bean = { ...bean, ...patch } as Bean;
    }),
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

  it('archives the bean and closes', async () => {
    const fake = makeFake(mkBean());
    const { onClose } = renderEditor(fake);
    fireEvent.click(await waitFor(() => screen.getByTestId('archive-bean-button')));
    fireEvent.click(
      await waitFor(() => screen.getByTestId('confirm-archive-bean-button')),
    );
    await waitFor(() =>
      expect(fake.saveBean).toHaveBeenCalledWith('b1', { archived: true }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('restores an archived bean and closes', async () => {
    const fake = makeFake(mkBean({ archived: true }));
    const { onClose } = renderEditor(fake);
    fireEvent.click(
      await waitFor(() => screen.getByTestId('restore-bean-button')),
    );
    await waitFor(() =>
      expect(fake.saveBean).toHaveBeenCalledWith('b1', { archived: false }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('does not offer the archive action for an already-archived bean', async () => {
    const fake = makeFake(mkBean({ archived: true }));
    renderEditor(fake);
    await waitFor(() => screen.getByTestId('restore-row'));
    expect(screen.queryByTestId('archive-bean-button')).toBeNull();
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
