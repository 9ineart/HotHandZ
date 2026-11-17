import type { ClientMsg, ServerMsg } from './protocol.js';

type Listener = (msg: ServerMsg) => void;

/**
 * Thin WebSocket client for the room server. By default it connects to the
 * same origin the game was served from (wss://<host>/hca-ws), which is what
 * the Vite dev/preview servers provide. Set VITE_HCA_SERVER_URL to point a
 * hosted build at a separately deployed room server.
 */
export class NetClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private queue: ClientMsg[] = [];
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  connected = false;

  constructor(private readonly url = NetClient.defaultUrl()) {}

  static defaultUrl(): string {
    const configured = import.meta.env.VITE_HCA_SERVER_URL as string | undefined;
    if (configured && configured.trim()) return configured.trim();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/hca-ws`;
  }

  connect(): void {
    if (this.ws || this.closed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      const pending = this.queue.splice(0);
      for (const msg of pending) ws.send(JSON.stringify(msg));
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      for (const l of this.listeners) l(msg);
    };
    ws.onclose = () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.ws = null;
      if (wasConnected) {
        for (const l of this.listeners)
          l({ type: 'error', message: 'Disconnected from room server' });
      }
      if (!this.closed) this.retryTimer = setTimeout(() => this.connect(), 2000);
    };
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.connected) this.ws.send(JSON.stringify(msg));
    else {
      // Only intents that still make sense after a reconnect are queued.
      if (msg.type === 'create' || msg.type === 'join' || msg.type === 'quick') this.queue.push(msg);
      this.connect();
    }
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
  }
}
