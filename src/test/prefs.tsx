import type { Component, JSX } from 'solid-js';
import { UserPrefsProvider } from '../UserPrefsContext';
import { MemoryStorage } from './memoryStorage';

/**
 * Wraps children in a UserPrefsProvider backed by a fresh in-memory store
 * for isolated test runs. Use in component tests whose subjects (StatusPanel,
 * Home, LiveEspressoView, …) read from the prefs context.
 *
 *   render(() => (
 *     <WithPrefs>
 *       <StatusPanel ... />
 *     </WithPrefs>
 *   ));
 */
export const WithPrefs: Component<{ children: JSX.Element }> = (p) => (
  <UserPrefsProvider storage={new MemoryStorage()}>
    {p.children}
  </UserPrefsProvider>
);
