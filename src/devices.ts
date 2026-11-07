import type { WsStatus } from './streams';

/**
 * Device inventory + connection state from `ws/v1/devices`.
 *
 * This is the gateway's authoritative answer to "is a machine/scale attached",
 * and since Decaid 0.8.2 it is the *only* one. The machine telemetry sockets
 * (`ws/v1/machine/*`) used to close when the machine went away, so socket
 * liveness doubled as a connection signal; they now stay open and simply go
 * silent, re-attaching when the machine returns. Deriving connectedness from
 * those sockets reports a machine that is long gone as still present.
 *
 * See doc/Api.md "Machine sockets re-bind across a reconnect" in the gateway
 * repo — the gateway explicitly will not add a status frame to those channels,
 * because each carries exactly one payload type.
 */

/** `grinder` arrived in Decaid v0.8.7. OverDose doesn't use grinders yet; the
 *  kind is listed so the inventory type matches what the gateway sends. */
export type DeviceKind = 'machine' | 'scale' | 'sensor' | 'grinder';

export type DeviceState =
  | 'discovered'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'disconnected';

export interface DeviceEntry {
  id: string;
  name: string;
  type: DeviceKind;
  state: DeviceState;
  /** Present in discovery or actively connected. Not a claim about ownership —
   *  controller-owned devices (Bengle's integrated scale) are inventory-only. */
  available?: boolean;
  /** Connected scales only (Decaid >=0.8.7). An `auxiliary` scale is an extra
   *  one some client asked for explicitly. Decaid's shot logic and
   *  `ws/v1/scale/snapshot` use only the primary scale. Absent on older
   *  gateways, where every connected scale is the primary. */
  connectionRole?: 'primary' | 'auxiliary';
}

export interface DevicesFrame {
  timestamp?: string;
  devices: DeviceEntry[];
  scanning?: boolean;
}

/**
 * Connectedness of one device kind, expressed in the same vocabulary the
 * header pills already speak.
 *
 * Both signals matter and they fail independently: the socket answers "can we
 * reach the gateway at all", the frame answers "is the device attached to it".
 * Trusting the frame alone would freeze at its last value the moment the
 * gateway goes away — the same failure this whole module exists to remove,
 * one level up.
 *
 * A device absent from the list is not connected: the gateway drops devices it
 * has never seen, and reports remembered-but-absent ones as `disconnected`.
 *
 * An auxiliary scale doesn't count as "the scale": stop-by-weight and the live
 * weight follow the primary scale only, so treating an auxiliary-only setup as
 * connected would pick a weight stop that can never fire.
 */
export function deviceStatus(
  socket: WsStatus,
  frame: DevicesFrame | null,
  kind: DeviceKind,
): WsStatus {
  if (socket !== 'open') return socket;
  // Socket is up but the first frame hasn't landed. The gateway replays
  // current state on connect, so this window is short — "connecting" rather
  // than "offline" keeps the pill from flashing red on every page load.
  if (!frame) return 'connecting';
  const connected = frame.devices.some(
    (d) =>
      d.type === kind &&
      d.state === 'connected' &&
      d.connectionRole !== 'auxiliary',
  );
  return connected ? 'open' : 'closed';
}

/** Convenience for the many callers that only want a boolean. */
export const isDeviceConnected = (
  socket: WsStatus,
  frame: DevicesFrame | null,
  kind: DeviceKind,
): boolean => deviceStatus(socket, frame, kind) === 'open';
