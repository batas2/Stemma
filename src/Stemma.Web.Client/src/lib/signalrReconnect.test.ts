// The live connection reconnects on its own after a drop — a laptop asleep, a dev server restarted —
// but what was announced while it was down is not sent again. Nothing listened for the reconnect,
// so the window went on showing the model, layout and comments from before the drop until the next
// edit happened to refresh them. Whoever needs to catch up can now hear that it is back.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const hub = vi.hoisted(() => ({
  built: [] as FakeConnection[],
}));

interface FakeConnection {
  state: string;
  connectionId: string | null;
  reconnected: ((id?: string) => void)[];
  on: () => void;
  onreconnected: (cb: (id?: string) => void) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

vi.mock('@microsoft/signalr', () => {
  const HubConnectionState = { Connected: 'Connected', Disconnected: 'Disconnected', Reconnecting: 'Reconnecting' };
  class HubConnectionBuilder {
    withUrl() { return this; }
    withAutomaticReconnect() { return this; }
    configureLogging() { return this; }
    build(): FakeConnection {
      const c: FakeConnection = {
        state: HubConnectionState.Disconnected,
        connectionId: null,
        reconnected: [],
        on: () => undefined,
        onreconnected: (cb) => { c.reconnected.push(cb); },
        start: async () => { c.state = HubConnectionState.Connected; c.connectionId = `conn-${hub.built.length}`; },
        stop: async () => { c.state = HubConnectionState.Disconnected; },
      };
      hub.built.push(c);
      return c;
    }
  }
  return { HubConnectionBuilder, HubConnectionState, LogLevel: { Warning: 3 } };
});

beforeEach(() => {
  hub.built.length = 0;
  vi.resetModules();
});

describe('after the live connection comes back', () => {
  it('whoever listens hears it once it has reconnected', async () => {
    const signalr = await import('./signalr');
    const heard = vi.fn();
    signalr.onReconnected(heard);
    await signalr.ensureConnection();
    expect(heard).not.toHaveBeenCalled();

    hub.built[0].reconnected.forEach((cb) => cb('conn-again'));
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('hears it too when the connection had given up and is made again', async () => {
    const signalr = await import('./signalr');
    const heard = vi.fn();
    signalr.onReconnected(heard);
    await signalr.ensureConnection();
    hub.built[0].state = 'Disconnected';

    await signalr.ensureConnection();
    expect(hub.built).toHaveLength(2);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('stops hearing it when it stops listening', async () => {
    const signalr = await import('./signalr');
    const heard = vi.fn();
    const off = signalr.onReconnected(heard);
    await signalr.ensureConnection();
    off();
    hub.built[0].reconnected.forEach((cb) => cb());
    expect(heard).not.toHaveBeenCalled();
  });
});
