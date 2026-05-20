import type { MachineSnapshot, ScaleSnapshot, ScaleStatusFrame } from './snapshot';

const el = (id: string): HTMLElement => {
  const node = document.querySelector<HTMLElement>(`[data-id="${id}"]`);
  if (!node) throw new Error(`Missing element data-id="${id}"`);
  return node;
};

export function renderMachine(s: MachineSnapshot): void {
  el('state').textContent = s.state.state;
  el('substate').textContent = s.state.substate;
  el('flow').textContent = `${s.flow.toFixed(2)} ml/s`;
  el('pressure').textContent = `${s.pressure.toFixed(2)} bar`;
  el('mixTemp').textContent = `${s.mixTemperature.toFixed(1)} °C`;
  el('groupTemp').textContent = `${s.groupTemperature.toFixed(1)} °C`;
}

export function renderScale(s: ScaleSnapshot): void {
  el('weight').textContent = `${s.weight.toFixed(2)} g`;
  el('battery').textContent = `${s.batteryLevel}%`;
}

export function renderScaleStatus(s: ScaleStatusFrame): void {
  el('scaleStatus').textContent = s.status;
  if (s.status === 'disconnected') {
    el('weight').textContent = '—';
    el('battery').textContent = '—';
  }
}

export function setConnection(state: 'connecting' | 'open' | 'closed'): void {
  const node = document.getElementById('conn');
  if (!node) return;
  node.dataset.state = state;
  node.textContent =
    state === 'open' ? 'connected' : state === 'closed' ? 'disconnected' : 'connecting…';
}
