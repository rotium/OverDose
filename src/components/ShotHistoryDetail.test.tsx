import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import type { Bean, GatewayShotSummary, ShotPatch } from '../api';
import { DEFAULT_TRACE_VISIBILITY, type TraceVisibility } from '../prefs';

vi.mock('./ShotMiniChart', () => ({
  ShotMiniChart: () => <div data-testid="shot-mini-chart-stub" />,
}));

import { ShotHistoryDetail } from './ShotHistoryDetail';

const shot: GatewayShotSummary = {
  id: 'shot-1',
  timestamp: '2026-06-14T09:14:00Z',
  workflow: {
    profile: { title: 'Decent Default' },
    context: { coffeeName: 'Ethiopia Guji', targetDoseWeight: 18 },
  },
  annotations: { enjoyment: 70, espressoNotes: 'Bright' },
};

const bean: Bean = {
  id: 'b1',
  roaster: 'Onyx',
  name: 'Geisha',
} as Bean;

const setup = (over: {
  updateShot?: (id: string, p: ShotPatch) => Promise<void>;
  deleteShot?: (id: string) => Promise<void>;
  onDeleted?: (id: string) => void;
  traceVisibility?: TraceVisibility;
  drinkerSuggestions?: string[];
} = {}) => {
  const onBack = vi.fn();
  const onDeleted = over.onDeleted ?? vi.fn();
  const updateShot = over.updateShot ?? vi.fn(() => Promise.resolve());
  const deleteShot = over.deleteShot ?? vi.fn(() => Promise.resolve());
  render(() => (
    <ShotHistoryDetail
      shot={shot}
      onBack={onBack}
      onDeleted={onDeleted}
      fetchShot={(id) => Promise.resolve({ ...shot, id, measurements: [] })}
      updateShot={updateShot}
      deleteShot={deleteShot}
      loadBean={() => Promise.resolve(bean)}
      loadBeans={() => Promise.resolve([bean])}
      traceVisibility={over.traceVisibility ? () => over.traceVisibility! : undefined}
      drinkerSuggestions={
        over.drinkerSuggestions ? () => over.drinkerSuggestions! : undefined
      }
    />
  ));
  return { onBack, onDeleted, updateShot, deleteShot };
};

describe('ShotHistoryDetail', () => {
  it('is read-only until Edit (coffee shown, no inputs, no Delete)', () => {
    setup();
    expect(screen.getByTestId('shot-detail-edit')).toBeInTheDocument();
    expect(screen.getByTestId('shot-detail-coffee')).toHaveTextContent(
      'Ethiopia Guji',
    );
    expect(screen.queryByTestId('shot-detail-notes')).toBeNull();
    expect(screen.queryByTestId('shot-detail-rating')).toBeNull();
    expect(screen.queryByTestId('shot-detail-delete')).toBeNull();
  });

  it('Edit reveals inputs, the bean control, and Delete', () => {
    setup();
    fireEvent.click(screen.getByTestId('shot-detail-edit'));
    expect(screen.getByTestId('shot-detail-notes')).toBeInTheDocument();
    expect(screen.getByTestId('shot-detail-rating')).toBeInTheDocument();
    expect(screen.getByTestId('shot-detail-bean')).toBeInTheDocument();
    expect(screen.getByTestId('shot-detail-grind')).toBeInTheDocument();
    expect(screen.getByTestId('shot-detail-delete')).toBeInTheDocument();
  });

  it('Save persists edited annotations under {annotations} and returns to read-only', async () => {
    const { updateShot } = setup();
    fireEvent.click(screen.getByTestId('shot-detail-edit'));
    fireEvent.input(screen.getByTestId('shot-detail-notes'), {
      target: { value: 'Sour, grind finer' },
    });
    fireEvent.click(screen.getByTestId('shot-detail-save'));
    await waitFor(() =>
      expect(updateShot).toHaveBeenCalledWith(
        'shot-1',
        expect.objectContaining({
          annotations: expect.objectContaining({
            espressoNotes: 'Sour, grind finer',
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('shot-detail-edit')).toBeInTheDocument(),
    );
  });

  it('Save writes a changed grind to workflow.context', async () => {
    const { updateShot } = setup();
    fireEvent.click(screen.getByTestId('shot-detail-edit'));
    const grind = screen.getByTestId('shot-detail-grind');
    fireEvent.input(grind, { target: { value: '5' } });
    fireEvent.blur(grind);
    fireEvent.click(screen.getByTestId('shot-detail-save'));
    await waitFor(() =>
      expect(updateShot).toHaveBeenCalledWith(
        'shot-1',
        expect.objectContaining({
          workflow: { context: expect.objectContaining({ grinderSetting: '5' }) },
        }),
      ),
    );
  });

  it('re-picking a bean writes the coffee trio to workflow.context', async () => {
    const { updateShot } = setup();
    fireEvent.click(screen.getByTestId('shot-detail-edit'));
    fireEvent.click(screen.getByTestId('shot-detail-bean'));
    fireEvent.click(await screen.findByTestId('bean-pick-b1'));
    await waitFor(() =>
      expect(screen.getByTestId('shot-detail-bean')).toHaveTextContent(
        'Onyx · Geisha',
      ),
    );
    fireEvent.click(screen.getByTestId('shot-detail-save'));
    await waitFor(() =>
      expect(updateShot).toHaveBeenCalledWith(
        'shot-1',
        expect.objectContaining({
          workflow: {
            context: expect.objectContaining({
              coffeeName: 'Geisha',
              coffeeRoaster: 'Onyx',
              extras: { beanId: 'b1' },
            }),
          },
        }),
      ),
    );
  });

  it('shows the dashed-targets legend toggle, on by default and togglable', () => {
    setup();
    const btn = screen.getByTestId('shot-detail-legend-targets');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the step-boundaries legend toggle, on by default and togglable', () => {
    setup();
    const btn = screen.getByTestId('shot-detail-legend-steps');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('seeds the chart legend from the saved default trace visibility', () => {
    setup({
      traceVisibility: {
        ...DEFAULT_TRACE_VISIBILITY,
        weightFlow: false,
        targets: false,
        steps: false,
      },
    });
    // All start hidden because Settings had them off.
    expect(screen.getByTestId('shot-detail-legend-weightFlow')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByTestId('shot-detail-legend-targets')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByTestId('shot-detail-legend-steps')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // A trace left on stays on.
    expect(screen.getByTestId('shot-detail-legend-pressure')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('Save writes an edited yield to annotations.actualYield', async () => {
    const { updateShot } = setup();
    fireEvent.click(screen.getByTestId('shot-detail-edit'));
    const y = screen.getByTestId('shot-detail-yield-input');
    fireEvent.input(y, { target: { value: '40' } });
    fireEvent.blur(y);
    fireEvent.click(screen.getByTestId('shot-detail-save'));
    await waitFor(() =>
      expect(updateShot).toHaveBeenCalledWith(
        'shot-1',
        expect.objectContaining({
          annotations: expect.objectContaining({ actualYield: 40 }),
        }),
      ),
    );
  });

  it('Save writes a drinker to workflow.context and shows it read-only', async () => {
    const { updateShot } = setup();
    fireEvent.click(screen.getByTestId('shot-detail-edit'));
    fireEvent.input(screen.getByTestId('shot-detail-drinker'), {
      target: { value: 'Maya' },
    });
    fireEvent.click(screen.getByTestId('shot-detail-save'));
    await waitFor(() =>
      expect(updateShot).toHaveBeenCalledWith(
        'shot-1',
        expect.objectContaining({
          workflow: { context: expect.objectContaining({ drinkerName: 'Maya' }) },
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('shot-detail-drinker-value')).toHaveTextContent(
        'Maya',
      ),
    );
  });

  it('suggests previously-used drinkers in the For field', async () => {
    setup({ drinkerSuggestions: ['Maya', 'Sam'] });
    fireEvent.click(screen.getByTestId('shot-detail-edit'));
    fireEvent.input(screen.getByTestId('shot-detail-drinker'), {
      target: { value: 'Ma' },
    });
    expect(
      await screen.findByTestId('shot-detail-drinker-option-0'),
    ).toHaveTextContent('Maya');
  });

  it('does not write a drinker when left empty', async () => {
    const { updateShot } = setup();
    fireEvent.click(screen.getByTestId('shot-detail-edit'));
    fireEvent.input(screen.getByTestId('shot-detail-notes'), {
      target: { value: 'just notes' },
    });
    fireEvent.click(screen.getByTestId('shot-detail-save'));
    await waitFor(() => expect(updateShot).toHaveBeenCalled());
    // No drinker typed → no workflow.context written at all.
    expect(updateShot).not.toHaveBeenCalledWith(
      'shot-1',
      expect.objectContaining({ workflow: expect.anything() }),
    );
  });

  it('enlarges the chart in a full-screen overlay and closes it', async () => {
    setup();
    expect(screen.queryByTestId('shot-chart-overlay')).toBeNull();
    fireEvent.click(screen.getByTestId('shot-detail-chart-expand'));
    expect(screen.getByTestId('shot-chart-overlay')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('shot-chart-overlay-close'));
    await waitFor(() =>
      expect(screen.queryByTestId('shot-chart-overlay')).toBeNull(),
    );
  });

  it('Cancel discards edits without persisting', () => {
    const { updateShot } = setup();
    fireEvent.click(screen.getByTestId('shot-detail-edit'));
    fireEvent.input(screen.getByTestId('shot-detail-notes'), {
      target: { value: 'changed' },
    });
    fireEvent.click(screen.getByTestId('shot-detail-cancel'));
    expect(updateShot).not.toHaveBeenCalled();
    expect(screen.getByTestId('shot-detail-edit')).toBeInTheDocument();
  });

  it('Delete (from edit mode) confirms, calls deleteShot, and reports back', async () => {
    const { deleteShot, onDeleted } = setup();
    fireEvent.click(screen.getByTestId('shot-detail-edit'));
    fireEvent.click(screen.getByTestId('shot-detail-delete'));
    fireEvent.click(await screen.findByTestId('shot-delete-go'));
    await waitFor(() => expect(deleteShot).toHaveBeenCalledWith('shot-1'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('shot-1'));
  });
});
