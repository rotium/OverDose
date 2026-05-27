import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { LibraryTab } from './LibraryTab';
import { WithRepositories } from '../../test/repositories';

const renderLibrary = () =>
  render(() => (
    <WithRepositories>
      <LibraryTab />
    </WithRepositories>
  ));

describe('LibraryTab', () => {
  it('renders all five subsection tabs', () => {
    renderLibrary();
    for (const label of ['Routines', 'Recipes', 'Beans', 'Profiles', 'Equipment']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }
  });

  it('defaults to Routines subsection', async () => {
    renderLibrary();
    expect(screen.getByRole('tab', { name: 'Routines' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(() => screen.getByTestId('routines-list'));
  });

  it('switches subsections when a tab is clicked', async () => {
    renderLibrary();
    fireEvent.click(screen.getByRole('tab', { name: 'Recipes' }));
    expect(screen.getByRole('tab', { name: 'Recipes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(() => screen.getByTestId('recipes-list'));
  });

  it('Beans / Profiles / Equipment render TODO shells', () => {
    renderLibrary();
    fireEvent.click(screen.getByRole('tab', { name: 'Beans' }));
    expect(screen.getByRole('heading', { name: 'Beans' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Profiles' }));
    expect(screen.getByRole('heading', { name: 'Profiles' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Equipment' }));
    expect(screen.getByRole('heading', { name: 'Equipment' })).toBeInTheDocument();
  });
});
