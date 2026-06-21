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

  describe('caret (browse without keyboard)', () => {
    it('tapping the caret opens the full list without focusing the input', () => {
      render(() => (
        // value equals a suggestion — browse must still show ALL options
        // (typing-mode would filter the exact match out).
        <AutocompleteInput value="Onyx" suggestions={SUGGESTIONS} testId="ac" />
      ));
      const input = screen.getByTestId('ac') as HTMLInputElement;
      fireEvent.click(screen.getByTestId('ac-caret'));
      const list = screen.getByTestId('ac-list');
      expect(list.querySelectorAll('li')).toHaveLength(3);
      expect(document.activeElement).not.toBe(input);
    });

    it('tapping the caret again closes the list', () => {
      render(() => (
        <AutocompleteInput value="Onyx" suggestions={SUGGESTIONS} testId="ac" />
      ));
      fireEvent.click(screen.getByTestId('ac-caret'));
      expect(screen.queryByTestId('ac-list')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('ac-caret'));
      expect(screen.queryByTestId('ac-list')).toBeNull();
    });

    it('selecting from the caret-opened list commits it', () => {
      const onInput = vi.fn();
      render(() => (
        <AutocompleteInput
          value=""
          suggestions={SUGGESTIONS}
          testId="ac"
          onInput={onInput}
        />
      ));
      fireEvent.click(screen.getByTestId('ac-caret'));
      fireEvent.mouseDown(screen.getByTestId('ac-option-1')); // Onyx
      expect(onInput).toHaveBeenCalledWith('Onyx');
      expect(screen.queryByTestId('ac-list')).toBeNull();
    });

    it('an outside tap closes the caret-opened list', () => {
      render(() => (
        <AutocompleteInput value="Onyx" suggestions={SUGGESTIONS} testId="ac" />
      ));
      fireEvent.click(screen.getByTestId('ac-caret'));
      expect(screen.queryByTestId('ac-list')).toBeInTheDocument();
      fireEvent.pointerDown(document.body);
      expect(screen.queryByTestId('ac-list')).toBeNull();
    });
  });
});
