import { Show, createResource, type Component } from 'solid-js';
import { api, type GatewayInfo } from '../../../api';

/**
 * App section (Settings → About → App). One card titled "App" with two
 * subsections:
 *  - Gateway: the reaprime gateway's build identity from `GET /api/v1/info`
 *    (version / commit / build time / LAN IP). Request/response only, static
 *    per gateway process → one-shot resource on mount (no polling); resolves
 *    to null on error so it degrades to "Gateway unavailable." copy.
 *  - Skin: this OverDose build (version + commit injected at build time), plus
 *    the repo and license links.
 */
export const AppSection: Component = () => {
  const [gateway] = createResource<GatewayInfo | null>(async () => {
    try {
      return await api.gatewayInfo();
    } catch (e) {
      console.warn('gatewayInfo fetch failed', e);
      return null;
    }
  });

  return (
    <section class="settings-section" data-testid="app-section">
      <h2>App</h2>

      <div class="settings-subsection" aria-labelledby="app-gateway-heading">
        <h3 class="settings-subheading" id="app-gateway-heading">
          Gateway
        </h3>
        <Show
          when={gateway()}
          fallback={
            <p class="settings-help" data-testid="gateway-info-empty">
              {gateway.loading
                ? 'Loading gateway info…'
                : 'Gateway unavailable.'}
            </p>
          }
        >
          {(g) => (
            <>
              <div class="info-row">
                <span class="info-row__label">Version</span>
                <span
                  class="info-row__value"
                  data-testid="gateway-info-version"
                >
                  {g().fullVersion || g().version || '—'}
                </span>
              </div>
              <div class="info-row">
                <span class="info-row__label">Commit</span>
                <span
                  class="info-row__value info-row__value--mono"
                  data-testid="gateway-info-commit"
                >
                  {[g().commitShort, g().branch].filter(Boolean).join(' · ') ||
                    '—'}
                </span>
              </div>
              <div class="info-row">
                <span class="info-row__label">Built</span>
                <span class="info-row__value" data-testid="gateway-info-built">
                  {g().buildTime || '—'}
                </span>
              </div>
              <div class="info-row">
                <span class="info-row__label">IP address</span>
                <span
                  class="info-row__value info-row__value--mono"
                  data-testid="gateway-info-ip"
                >
                  {g().localIp || '—'}
                </span>
              </div>
            </>
          )}
        </Show>
      </div>

      <div class="settings-subsection" aria-labelledby="app-skin-heading">
        <h3 class="settings-subheading" id="app-skin-heading">
          Skin
        </h3>
        <p class="settings-help" data-testid="app-version">
          OverDose v{__APP_VERSION__} · {__GIT_COMMIT__}
        </p>
        <p class="settings-help">
          A focused, recipe-driven interface for your Decent espresso machine.
        </p>
        <p class="settings-help" data-testid="about-repo">
          <a
            href="https://github.com/rotium/OverDose"
            target="_blank"
            rel="noopener noreferrer"
          >
            github.com/rotium/OverDose
          </a>
        </p>
        <p class="settings-help" data-testid="about-license">
          Licensed under{' '}
          <a
            href="https://www.gnu.org/licenses/gpl-3.0.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            GPL-3.0
          </a>
          .
        </p>
      </div>
    </section>
  );
};
