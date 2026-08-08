import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { HotWaterSection } from './HotWaterSection';
import { WithRepositories } from '../../../../test/repositories';
import { LocalVesselRepository } from '../../../../repositories';
import { MemoryStorage } from '../../../../test/memoryStorage';

const mount = (vessels?: LocalVesselRepository) =>
  render(() => (
    <WithRepositories vessels={vessels}>
      <HotWaterSection />
    </WithRepositories>
  ));

describe('HotWaterSection', () => {
  it('lists the seeded vessels with size and flow', async () => {
    mount();
    await waitFor(() => screen.getByTestId('vessels-list'));
    expect(screen.getByTestId('vessel-row-seed-vessel-cup')).toHaveTextContent(
      'Cup',
    );
    expect(screen.getByTestId('vessel-row-seed-vessel-mug')).toHaveTextContent(
      '300 mL · 6.0 mL/s',
    );
  });

  it('creates a vessel from plain defaults, reading nothing from the machine', async () => {
    const repo = new LocalVesselRepository(new MemoryStorage());
    mount(repo);
    await waitFor(() => screen.getByTestId('open-new-vessel'));
    fireEvent.click(screen.getByTestId('open-new-vessel'));
    fireEvent.input(screen.getByTestId('new-vessel-name'), {
      target: { value: 'Teapot' },
    });
    fireEvent.click(screen.getByTestId('confirm-new-vessel'));

    await waitFor(async () => {
      const all = await repo.list();
      const made = all.find((v) => v.name === 'Teapot');
      expect(made).toMatchObject({ capacityMl: 250, flow: 6 });
    });
  });

  it('opens the editor for a vessel', async () => {
    mount();
    await waitFor(() => screen.getByTestId('vessels-list'));
    fireEvent.click(screen.getByTestId('vessel-row-seed-vessel-mug'));
    expect(await screen.findByTestId('vessel-editor')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        (screen.getByTestId('vessel-name-input') as HTMLInputElement).value,
      ).toBe('Mug'),
    );
  });

  it('reports an empty library rather than an empty list', async () => {
    const repo = new LocalVesselRepository(new MemoryStorage());
    for (const v of await repo.list()) await repo.delete(v.id);
    mount(repo);
    await waitFor(() => expect(screen.getByText('no vessels yet')).toBeInTheDocument());
  });
});
