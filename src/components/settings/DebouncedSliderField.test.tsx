import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { DebouncedSliderField } from './DebouncedSliderField';

describe('DebouncedSliderField', () => {
  it('renders with the initial value', () => {
    const onCommit = vi.fn();
    render(() => (
      <DebouncedSliderField
        testId="slider"
        value={1.2}
        onCommit={onCommit}
        min={0.4}
        max={2.0}
        step={0.1}
        debounceMs={0}
      />
    ));
    expect((screen.getByTestId('slider') as HTMLInputElement).value).toBe('1.2');
    expect(screen.getByTestId('slider-value')).toHaveTextContent('1.2');
  });

  it('falls back to min when value is undefined and does not commit on its own', () => {
    const onCommit = vi.fn();
    render(() => (
      <DebouncedSliderField
        testId="slider"
        value={undefined}
        onCommit={onCommit}
        min={0.4}
        max={2.0}
        step={0.1}
        debounceMs={0}
      />
    ));
    expect((screen.getByTestId('slider') as HTMLInputElement).value).toBe('0.4');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits on input when debounceMs=0 (sync mode for tests)', () => {
    const onCommit = vi.fn();
    render(() => (
      <DebouncedSliderField
        testId="slider"
        value={1.0}
        onCommit={onCommit}
        min={0.4}
        max={2.0}
        step={0.1}
        debounceMs={0}
      />
    ));
    const input = screen.getByTestId('slider') as HTMLInputElement;
    input.value = '1.5';
    fireEvent.input(input);
    expect(onCommit).toHaveBeenCalledWith(1.5);
  });

  it('debounces multiple rapid input events into a single commit', async () => {
    const onCommit = vi.fn();
    vi.useFakeTimers();
    try {
      render(() => (
        <DebouncedSliderField
          testId="slider"
          value={1.0}
          onCommit={onCommit}
          min={0.4}
          max={2.0}
          step={0.1}
          debounceMs={250}
        />
      ));
      const input = screen.getByTestId('slider') as HTMLInputElement;
      input.value = '1.3';
      fireEvent.input(input);
      input.value = '1.5';
      fireEvent.input(input);
      input.value = '1.7';
      fireEvent.input(input);
      expect(onCommit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(250);
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(1.7);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes immediately on pointer-up (drag release), bypassing debounce', () => {
    const onCommit = vi.fn();
    vi.useFakeTimers();
    try {
      render(() => (
        <DebouncedSliderField
          testId="slider"
          value={1.0}
          onCommit={onCommit}
          min={0.4}
          max={2.0}
          step={0.1}
          debounceMs={250}
        />
      ));
      const input = screen.getByTestId('slider') as HTMLInputElement;
      fireEvent.pointerDown(input);
      input.value = '1.6';
      fireEvent.input(input);
      fireEvent.pointerUp(input);
      // Pointer-up flushed without waiting for the debounce.
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(1.6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('commits once when a drag release fires both pointerup and change', () => {
    // Real range inputs dispatch both `pointerup` AND `change` on mouse/touch
    // release — without dedupe that doubles the gateway write. (The other
    // tests never fire `change`, which is why they missed it.)
    const onCommit = vi.fn();
    vi.useFakeTimers();
    try {
      render(() => (
        <DebouncedSliderField
          testId="slider"
          value={1.0}
          onCommit={onCommit}
          min={0.4}
          max={2.0}
          step={0.1}
          debounceMs={250}
        />
      ));
      const input = screen.getByTestId('slider') as HTMLInputElement;
      fireEvent.pointerDown(input);
      input.value = '1.6';
      fireEvent.input(input);
      fireEvent.pointerUp(input);
      fireEvent.change(input);
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(1.6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT snap to external value while the user is dragging', () => {
    const [value, setValue] = createSignal<number | undefined>(1.0);
    render(() => (
      <DebouncedSliderField
        testId="slider"
        value={value()}
        onCommit={() => {}}
        min={0.4}
        max={2.0}
        step={0.1}
        debounceMs={0}
      />
    ));
    const input = screen.getByTestId('slider') as HTMLInputElement;
    fireEvent.pointerDown(input);
    input.value = '1.4';
    fireEvent.input(input);
    // Imagine an external refetch lands while the user is still dragging.
    setValue(1.8);
    // Slider keeps the user's in-progress value, not the refetch.
    expect(input.value).toBe('1.4');
  });

  it('snaps to external value when not actively dragging', () => {
    const [value, setValue] = createSignal<number | undefined>(1.0);
    render(() => (
      <DebouncedSliderField
        testId="slider"
        value={value()}
        onCommit={() => {}}
        min={0.4}
        max={2.0}
        step={0.1}
        debounceMs={0}
      />
    ));
    setValue(1.8);
    expect((screen.getByTestId('slider') as HTMLInputElement).value).toBe('1.8');
  });

  it('uses formatValue for the inline readout', () => {
    render(() => (
      <DebouncedSliderField
        testId="slider"
        value={1.5}
        onCommit={() => {}}
        min={0.4}
        max={2.0}
        step={0.1}
        debounceMs={0}
        formatValue={(v) => `${v.toFixed(1)} mL/s`}
      />
    ));
    expect(screen.getByTestId('slider-value')).toHaveTextContent('1.5 mL/s');
  });
});
