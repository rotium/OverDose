import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { PickerDialog } from './PickerDialog';

describe('PickerDialog', () => {
  // Helper: mounts the dialog with controllable `open` + an onClose spy.
  const renderDialog = (initialOpen = true) => {
    const onClose = vi.fn();
    const [open, setOpen] = createSignal(initialOpen);
    render(() => (
      <PickerDialog
        open={open()}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        title="Pick something"
        description="Choose the one you want."
      >
        <button data-testid="inner-button">inner</button>
      </PickerDialog>
    ));
    return { onClose, setOpen };
  };

  it('renders the dialog with title and body when open', () => {
    renderDialog(true);
    expect(screen.getByTestId('picker-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('picker-dialog')).toHaveAttribute(
      'aria-modal',
      'true',
    );
    expect(screen.getByText('Pick something')).toBeInTheDocument();
    expect(screen.getByText('Choose the one you want.')).toBeInTheDocument();
    expect(screen.getByTestId('inner-button')).toBeInTheDocument();
  });

  it('is not in the DOM when open=false from the start', () => {
    renderDialog(false);
    expect(screen.queryByTestId('picker-dialog')).not.toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const { onClose } = renderDialog(true);
    fireEvent.click(screen.getByTestId('picker-dialog-close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does NOT call onClose when the backdrop is clicked (default modal behavior)', () => {
    // Pickers commit user intent (Recipe profile, future Bean/Grinder) —
    // a stray backdrop click must not silently discard whatever the user
    // was previewing. Explicit close button / Escape only.
    const { onClose } = renderDialog(true);
    fireEvent.click(screen.getByTestId('picker-dialog-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('opts in to backdrop dismissal via dismissibleOnBackdrop', () => {
    const onClose = vi.fn();
    render(() => (
      <PickerDialog
        open={true}
        onClose={onClose}
        title="dismissible"
        dismissibleOnBackdrop={true}
      >
        <span />
      </PickerDialog>
    ));
    fireEvent.click(screen.getByTestId('picker-dialog-backdrop'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does NOT call onClose when a click inside the dialog body bubbles up', () => {
    // Clicks on the dialog content (or any inner widget) shouldn't be
    // mistaken for a backdrop click. The handler discriminates by
    // currentTarget vs target.
    const { onClose } = renderDialog(true);
    fireEvent.click(screen.getByTestId('inner-button'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose on Escape keydown while open', () => {
    const { onClose } = renderDialog(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ignores Escape when not open', () => {
    const { onClose } = renderDialog(false);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops Escape from reaching a parent window-level keydown listener", () => {
    // RecipesSection registers a window keydown listener that closes the
    // recipe editor on Escape. The picker dialog runs inside the editor;
    // pressing Escape to dismiss the picker must NOT also close the
    // editor. The fix is a capture-phase listener that
    // stopImmediatePropagation's. This test mounts a "parent" listener
    // and asserts it never sees the Escape.
    const parentEscape = vi.fn();
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') parentEscape();
    });
    const { onClose } = renderDialog(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(parentEscape).not.toHaveBeenCalled();
  });

  it('renders the footer slot when provided', () => {
    render(() => (
      <PickerDialog
        open={true}
        onClose={() => {}}
        title="With footer"
        footer={<button data-testid="footer-btn">Footer</button>}
      >
        <span />
      </PickerDialog>
    ));
    expect(screen.getByTestId('picker-dialog-footer')).toBeInTheDocument();
    expect(screen.getByTestId('footer-btn')).toBeInTheDocument();
  });

  it('omits the footer element entirely when no footer is provided', () => {
    render(() => (
      <PickerDialog open={true} onClose={() => {}} title="No footer">
        <span />
      </PickerDialog>
    ));
    expect(
      screen.queryByTestId('picker-dialog-footer'),
    ).not.toBeInTheDocument();
  });

  it('respects a custom testId override', () => {
    render(() => (
      <PickerDialog
        open={true}
        onClose={() => {}}
        title="t"
        testId="my-dialog"
      >
        <span />
      </PickerDialog>
    ));
    expect(screen.getByTestId('my-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('my-dialog-backdrop')).toBeInTheDocument();
    expect(screen.getByTestId('my-dialog-close')).toBeInTheDocument();
  });
});
