import { Show, createResource, type Component } from 'solid-js';
import { api, type MachineInfo } from '../../../api';
import { log } from '../../../debugLog';

/**
 * Read-only machine identity card (Settings → About → Machine). Fed by
 * `api.machineInfo()` — request/response only, no WS stream, and static per
 * connection, so a one-shot resource fetched on mount is the right shape (no
 * polling). The fetcher catches and resolves to null so a disconnected machine
 * (the gateway errors `/machine/info` when nothing is connected) renders the
 * "No machine connected." copy rather than throwing. First UI consumer of the
 * `GHC` flag.
 */
export const MachineInfoSection: Component = () => {
  const [machineInfo] = createResource<MachineInfo | null>(async () => {
    try {
      return await api.machineInfo();
    } catch (e) {
      log.warn('info', 'machineInfo fetch failed', e);
      return null;
    }
  });

  return (
    <section class="settings-section" data-testid="machine-info-section">
      <h2>Machine</h2>
      <Show
        when={machineInfo()}
        fallback={
          <p class="settings-help" data-testid="machine-info-empty">
            {machineInfo.loading
              ? 'Loading machine info…'
              : 'No machine connected.'}
          </p>
        }
      >
        {(info) => (
          <>
            <div class="info-row">
              <span class="info-row__label">Model</span>
              <span class="info-row__value" data-testid="machine-info-model">
                {info().model || '—'}
              </span>
            </div>
            <div class="info-row">
              <span class="info-row__label">Firmware</span>
              <span class="info-row__value" data-testid="machine-info-firmware">
                {info().version || '—'}
              </span>
            </div>
            <div class="info-row">
              <span class="info-row__label">Serial</span>
              <span
                class="info-row__value info-row__value--mono"
                data-testid="machine-info-serial"
              >
                {info().serialNumber || '—'}
              </span>
            </div>
            <div class="info-row">
              <span class="info-row__label">Group head controller</span>
              <span
                class="machine-info-pill"
                classList={{ 'machine-info-pill--yes': info().GHC }}
                data-testid="machine-info-ghc"
              >
                <span class="machine-info-pill__dot" />
                {info().GHC ? 'Present' : 'Not present'}
              </span>
            </div>
          </>
        )}
      </Show>
    </section>
  );
};
