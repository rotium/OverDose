import { render } from 'solid-js/web';
import { App } from './App';
import './styles.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');

console.info(`OverDose v${__APP_VERSION__} (${__GIT_COMMIT__})`);

render(() => <App />, root);
