// Room transport over public MQTT brokers (works from any network, no server needed).
// Topics per room:  <base>/s  host state (retained) | <base>/c  player commands -> host | <base>/r  reactions
const BROKERS = {
  emqx: 'wss://broker.emqx.io:8084/mqtt',
  hivemq: 'wss://broker.hivemq.com:8884/mqtt',
};
const PREFIX = 'mm-ar-v2';

export const brokerFor = (code) => (String(code)[0] === '9' ? 'hivemq' : 'emqx');
export const newCode = (broker = 'emqx') => {
  const first = broker === 'hivemq' ? 9 : 1 + Math.floor(Math.random() * 8);
  return `${first}${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
};

export class RoomLink {
  constructor({ code, isHost, playerId, onState, onCommand, onReaction, onConn }) {
    Object.assign(this, { code, isHost, playerId, onState, onCommand, onReaction, onConn });
    this.base = `${PREFIX}/${code}`;
    this.client = null;
    this.closed = false;
  }

  connect(timeoutMs = 9000) {
    return new Promise((resolve, reject) => {
      if (!window.mqtt) { reject(new Error('mqtt library missing')); return; }
      const will = this.isHost
        ? { topic: `${this.base}/s`, payload: JSON.stringify({ phase: 'closed' }), qos: 1, retain: true }
        : { topic: `${this.base}/c`, payload: JSON.stringify({ t: 'leave', id: this.playerId }), qos: 1, retain: false };
      const client = window.mqtt.connect(BROKERS[brokerFor(this.code)], {
        clientId: `mmar_${Math.random().toString(36).slice(2, 12)}`,
        clean: true, keepalive: 20, connectTimeout: timeoutMs, reconnectPeriod: 2500, will,
      });
      this.client = client;
      let settled = false;
      const t = setTimeout(() => { if (!settled) { settled = true; try { client.end(true); } catch { /* */ } reject(new Error('timeout')); } }, timeoutMs + 500);
      client.on('connect', () => {
        this.onConn?.('online');
        client.subscribe([`${this.base}/s`, `${this.base}/c`, `${this.base}/r`], { qos: 1 }, (err) => {
          if (settled) return;
          settled = true; clearTimeout(t);
          err ? reject(err) : resolve(this);
        });
      });
      client.on('reconnect', () => this.onConn?.('reconnecting'));
      client.on('offline', () => this.onConn?.('offline'));
      client.on('error', (e) => { if (!settled) { settled = true; clearTimeout(t); reject(e); } });
      client.on('message', (topic, buf) => {
        if (this.closed) return;
        let msg; try { msg = buf.length ? JSON.parse(buf.toString()) : null; } catch { return; }
        if (!msg) return;
        if (topic.endsWith('/s')) this.onState?.(msg);
        else if (topic.endsWith('/c')) this.onCommand?.(msg);
        else if (topic.endsWith('/r')) this.onReaction?.(msg);
      });
    });
  }

  /** Wait for the retained room state (guests use this to check the room exists). */
  waitForState(ms = 5000) {
    return new Promise((resolve) => {
      const prev = this.onState;
      const t = setTimeout(() => { this.onState = prev; resolve(null); }, ms);
      this.onState = (s) => { clearTimeout(t); this.onState = prev; resolve(s); prev?.(s); };
    });
  }

  publishState(state) {
    this.client?.publish(`${this.base}/s`, JSON.stringify(state), { qos: 1, retain: true });
  }
  send(cmd) {
    this.client?.publish(`${this.base}/c`, JSON.stringify(cmd), { qos: 1 });
  }
  react(emoji, name) {
    this.client?.publish(`${this.base}/r`, JSON.stringify({ e: emoji, n: name }), { qos: 0 });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const c = this.client;
    if (!c) return;
    try {
      if (this.isHost) c.publish(`${this.base}/s`, JSON.stringify({ phase: 'closed' }), { qos: 1, retain: true });
      else c.publish(`${this.base}/c`, JSON.stringify({ t: 'leave', id: this.playerId }), { qos: 1 });
      setTimeout(() => { try { c.end(true); } catch { /* */ } }, 400);
    } catch { /* */ }
  }
}
