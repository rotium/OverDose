import { render } from 'solid-js/web';
import { App } from './App';
import { initKeyboardInset } from './keyboardInset';
import './styles.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');

console.info(`OverDose v${__APP_VERSION__} (${__GIT_COMMIT__})`);

initKeyboardInset();

render(() => <App />, root);
