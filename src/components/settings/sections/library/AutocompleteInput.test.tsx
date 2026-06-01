import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { AutocompleteInput } from './AutocompleteInput';

const SUGGESTIONS = ['Has Bean', 'Onyx', 'Square Mile'];

describe('AutocompleteInput', () => {
  it('filters suggestions by the typed text', async () => {
    render(() => (
      <AutocompleteInput
        value=""
        suggestions={SUGGESTIONS}
        testId="ac"
        onInput={() => {}}
      />
    ));
    const input = screen.getByTestId('ac') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'on' } });
    await waitFor(() => screen.getByTestId('ac-list'));
    const opts = screen.getByTestId('ac-list').querySelectorAll('li');
    expect([...opts].map((o) => o.textContent)).toEqual(['Onyx']);
  });

  it('selecting an option fires onInput and onChange and closes', async () => {
    const onInput = vi.fn();
    const onChange = vi.fn();
    render(() => (
      <AutocompleteInput
        value=""
        suggestions={SUGGESTIONS}
        testId="ac"
        onInput={onInput}
        onChange={onChange}
      />
    ));
    const input = screen.getByTestId('ac') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'sq' } });
    const option = await waitFor(() => screen.getByTestId('ac-option-0'));
    fireEvent.mouseDown(option);
    expect(onInput).toHaveBeenCalledWith('Square Mile');
    expect(onChange).toHaveBeenCalledWith('Square Mile');
    await waitFor(() => expect(screen.queryByTestId('ac-list')).toBeNull());
  });

  it('does not suggest when the text already equals a suggestion', async () => {
    render(() => (
      <AutocompleteInput value="" suggestions={SUGGESTIONS} testId="ac" />
    ));
    const input = screen.getByTestId('ac') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'Onyx' } });
    // List should not appear (exact match is filtered out).
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('ac-list')).toBeNull();
  });

  it('keeps in sync with an external value change while unfocused', async () => {
    const [value, setValue] = createSignal('start');
    render(() => (
      <AutocompleteInput value={value()} suggestions={[]} testId="ac" />
    ));
    const input = screen.getByTestId('ac') as HTMLInputElement;
    expect(input.value).toBe('start');
    setValue('updated');
    await waitFor(() => expect(input.value).toBe('updated'));
  });

  it('Escape with the list closed calls onEscape', async () => {
    const onEscape = vi.fn();
    render(() => (
      <AutocompleteInput
        value=""
        suggestions={[]}
        testId="ac"
        onEscape={onEscape}
      />
    ));
    const input = screen.getByTestId('ac') as HTMLInputElement;
    // No suggestions → list never opens → Escape bubbles to onEscape.
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalled();
  });
});
