import { type Component } from 'solid-js';
import { api } from './api';
import { Home, defaultStreams } from './Home';
import { LocalWorkflowRepository } from './repositories';
import type { Workflow } from './domain';
import type { ShotSettingsSnapshot } from './snapshot';

const workflowRepository = new LocalWorkflowRepository();

const onSleep = () =>
  api.sleep().catch((e) => console.warn('sleep failed', e));

const onUpdateShotSettings = (settings: ShotSettingsSnapshot) =>
  api.updateShotSettings(settings).catch((e) =>
    console.warn('updateShotSettings failed', e),
  );

const onMenu = () => console.info('menu — TODO: open drawer');
const onSelectWorkflow = (w: Workflow) =>
  console.info('selected workflow — TODO: route to runtime', w);
const onSeeAllShots = () => console.info('see all shots — TODO: route to history');

export const App: Component = () => (
  <Home
    workflowRepository={workflowRepository}
    machineStream={defaultStreams.machine}
    scaleStream={defaultStreams.scale}
    shotSettingsStream={defaultStreams.shotSettings}
    waterLevelsStream={defaultStreams.waterLevels}
    fetchLatestShot={api.shotsLatest}
    fetchShot={api.shotById}
    onSleep={onSleep}
    onUpdateShotSettings={onUpdateShotSettings}
    onMenu={onMenu}
    onSelectWorkflow={onSelectWorkflow}
    onSeeAllShots={onSeeAllShots}
  />
);
