import crypto from 'crypto';

export const SessionState = Object.freeze({
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  PAUSED: 'paused',
  ENDED: 'ended'
});

function nowMs() { return Date.now(); }

export class Session {
  constructor(opts = {}) {
    this.id = opts.id || crypto.randomUUID();
    this.state = SessionState.IDLE;
    this.createdAt = nowMs();
    this.startedAt = null;
    this.endedAt = null;
    this.billingStartedAt = null;
    this.billingMs = 0;
    this.lastActivityAt = null;
    this.silenceMs = 0;
    this.silenceThresholdMs = opts.silenceThresholdMs || 15000; // 15s
    this.history = []; // {role, content, timestamp}
  }

  start() {
    if (this.state !== SessionState.IDLE && this.state !== SessionState.PAUSED) return;
    const t = nowMs();
    if (!this.startedAt) this.startedAt = t;
    this.state = SessionState.LISTENING;
    this.lastActivityAt = t;
  }

  pause() {
    if (this.state === SessionState.PAUSED || this.state === SessionState.ENDED) return;
    this._accumulateBilling();
    this.state = SessionState.PAUSED;
  }

  end() {
    if (this.state === SessionState.ENDED) return;
    this._accumulateBilling();
    this.state = SessionState.ENDED;
    this.endedAt = nowMs();
  }

  beginBilling() {
    if (this.billingStartedAt == null) {
      this.billingStartedAt = nowMs();
    }
  }

  _accumulateBilling() {
    if (this.billingStartedAt != null) {
      this.billingMs += Math.max(0, nowMs() - this.billingStartedAt);
      this.billingStartedAt = null;
    }
  }

  addUserMessage(content) {
    const t = nowMs();
    this.history.push({ role: 'user', content, timestamp: t });
    this.lastActivityAt = t;
    this.silenceMs = 0;
  }

  addAssistantMessage(content) {
    const t = nowMs();
    this.history.push({ role: 'assistant', content, timestamp: t });
  }

  tick() {
    if (this.state === SessionState.LISTENING) {
      const delta = nowMs() - (this.lastActivityAt || nowMs());
      this.silenceMs = delta;
    }
  }

  getStatus() {
    const now = nowMs();
    const durationMs = this.startedAt ? (this.endedAt || now) - this.startedAt : 0;
    const boundedDurationMs = Math.max(0, Math.min(durationMs, 24 * 60 * 60 * 1000));
    const billingActive = this.billingStartedAt != null;
    const billingTotalMs = billingActive ? (this.billingMs + Math.max(0, now - this.billingStartedAt)) : this.billingMs;

    return {
      id: this.id,
      state: this.state,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      durationMs: boundedDurationMs,
      billing: {
        active: billingActive,
        totalMs: billingTotalMs
      },
      listening: this.state === SessionState.LISTENING,
      silenceMs: this.silenceMs,
      silenceThresholdMs: this.silenceThresholdMs,
      canPromptSilence: this.silenceMs >= this.silenceThresholdMs
    };
  }
}

export class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  create(opts = {}) {
    const s = new Session(opts);
    this.sessions.set(s.id, s);
    return s;
  }

  get(id) { return this.sessions.get(id) || null; }

  ensure(id) {
    return this.sessions.get(id) || this.create({ id });
  }
}


