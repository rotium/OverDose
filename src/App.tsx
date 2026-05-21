import { onMount, type Component } from 'solid-js';
import { api } from './api';
import { ConnectionBadge } from './components/ConnectionBadge';
import { Machine } from './components/Machine';
import { Scale } from './components/Scale';
import { ShotChart } from './components/ShotChart';
import type { MachineSnapshot, ScaleMessage } from './snapshot';
import { createWsStream } from './streams';

export const App: Component = () => {
  const machine = createWsStream<MachineSnapshot>(
    '/ws/v1/machine/snapshot',
    'machine',
  );
  const scale = createWsStream<ScaleMessage>('/ws/v1/scale/snapshot', 'scale');

  onMount(() => {
    api
      .machineInfo()
      .then((info) => console.log('machine info', info))
      .catch((e) => console.warn('machine info failed', e));
  });

  return (
    <main>
      <header>
        <h1>Decent.app — Starter Skin</h1>
        <ConnectionBadge status={machine.status} />
      </header>
      <Machine snapshot={machine.latest} />
      <ShotChart machine={machine.latest} scale={scale.latest} />
      <Scale message={scale.latest} />
    </main>
  );
};
