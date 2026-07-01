import { render } from 'solid-js/web';
import { App } from './App';
import { initKeyboardInset } from './keyboardInset';
import { log } from './debugLog';
import { gatewayHttpOrigin } from './gateway';
import './styles.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');

log.info(
  'boot',
  `OverDose v${__APP_VERSION__} (${__GIT_COMMIT__}) → gateway ${gatewayHttpOrigin() || 'same-origin'}`,
);

// Capture otherwise-invisible failures: uncaught errors and rejected promises
// vanish on a real gateway (no devtools), so funnel them into the log buffer +
// console capture at error level. Registered before render so a crash during
// mount is still recorded. Active at the default `info` threshold until the
// stored log-level pref loads (errors always emit).
window.addEventListener('error', (e) => {
  log.error('global', 'uncaught', e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  log.error('global', 'unhandledrejection', e.reason);
});

initKeyboardInset();

render(() => <App />, root);
