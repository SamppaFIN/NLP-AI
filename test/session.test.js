import { Session, SessionManager, SessionState } from '../src/session.js';
import { describe, it, expect, beforeEach } from 'vitest';

describe('Session', () => {
  let session;

  beforeEach(() => {
    session = new Session();
  });

  describe('Initialization', () => {
    it('should initialize with correct default values', () => {
      expect(session.id).toBeDefined();
      expect(session.state).toBe(SessionState.IDLE);
      expect(session.createdAt).toBeGreaterThan(0);
      expect(session.startedAt).toBeNull();
      expect(session.endedAt).toBeNull();
      expect(session.billingStartedAt).toBeNull();
      expect(session.billingMs).toBe(0);
      expect(session.silenceMs).toBe(0);
      expect(session.silenceThresholdMs).toBe(15000);
      expect(session.history).toEqual([]);
    });

    it('should accept custom options', () => {
      const customSession = new Session({
        id: 'test-id',
        silenceThresholdMs: 30000
      });
      expect(customSession.id).toBe('test-id');
      expect(customSession.silenceThresholdMs).toBe(30000);
    });
  });

  describe('State Transitions', () => {
    it('should start from IDLE', () => {
      session.start();
      expect(session.state).toBe(SessionState.LISTENING);
      expect(session.startedAt).toBeGreaterThan(0);
      expect(session.lastActivityAt).toBeGreaterThan(0);
    });

    it('should start from PAUSED', () => {
      session.state = SessionState.PAUSED;
      session.start();
      expect(session.state).toBe(SessionState.LISTENING);
    });

    it('should not start from non-idle/paused states', () => {
      session.state = SessionState.LISTENING;
      const originalState = session.state;
      session.start();
      expect(session.state).toBe(originalState);
    });

    it('should pause from listening/processing', () => {
      session.state = SessionState.LISTENING;
      session.pause();
      expect(session.state).toBe(SessionState.PAUSED);
    });

    it('should end session', () => {
      session.start();
      session.end();
      expect(session.state).toBe(SessionState.ENDED);
      expect(session.endedAt).toBeGreaterThan(0);
    });
  });

  describe('Billing Management', () => {
    it('should start billing', () => {
      session.beginBilling();
      expect(session.billingStartedAt).toBeGreaterThan(0);
    });

    it('should accumulate billing time on pause', () => {
      session.beginBilling();
      const startTime = session.billingStartedAt;
      
      // Simulate time passing
      setTimeout(() => {
        session.pause();
        expect(session.billingMs).toBeGreaterThan(0);
        expect(session.billingStartedAt).toBeNull();
      }, 10);
    });

    it('should accumulate billing time on end', () => {
      session.beginBilling();
      const startTime = session.billingStartedAt;
      
      setTimeout(() => {
        session.end();
        expect(session.billingMs).toBeGreaterThan(0);
        expect(session.billingStartedAt).toBeNull();
      }, 10);
    });
  });

  describe('Message History', () => {
    it('should add user message', () => {
      const content = 'Hello, AI';
      session.addUserMessage(content);
      
      expect(session.history).toHaveLength(1);
      expect(session.history[0]).toEqual({
        role: 'user',
        content,
        timestamp: expect.any(Number)
      });
      expect(session.lastActivityAt).toBeGreaterThan(0);
      expect(session.silenceMs).toBe(0);
    });

    it('should add assistant message', () => {
      const content = 'Hello, how can I help?';
      session.addAssistantMessage(content);
      
      expect(session.history).toHaveLength(1);
      expect(session.history[0]).toEqual({
        role: 'assistant',
        content,
        timestamp: expect.any(Number)
      });
    });
  });

  describe('Silence Detection', () => {
    it('should track silence in listening state', () => {
      session.state = SessionState.LISTENING;
      session.lastActivityAt = Date.now() - 20000; // 20 seconds ago
      
      session.tick();
      expect(session.silenceMs).toBeGreaterThan(15000);
    });

    it('should not track silence in non-listening states', () => {
      session.state = SessionState.PAUSED;
      session.lastActivityAt = Date.now() - 20000;
      
      session.tick();
      expect(session.silenceMs).toBe(0);
    });
  });

  describe('Status Reporting', () => {
    it('should return correct status for new session', () => {
      const status = session.getStatus();
      
      expect(status.id).toBe(session.id);
      expect(status.state).toBe(SessionState.IDLE);
      expect(status.durationMs).toBe(0);
      expect(status.billing.active).toBe(false);
      expect(status.billing.totalMs).toBe(0);
      expect(status.listening).toBe(false);
      expect(status.silenceMs).toBe(0);
      expect(status.canPromptSilence).toBe(false);
    });

    it('should return correct status for active session', () => {
      session.start();
      session.beginBilling();
      
      const status = session.getStatus();
      
      expect(status.state).toBe(SessionState.LISTENING);
      expect(status.durationMs).toBeGreaterThan(0);
      expect(status.billing.active).toBe(true);
      expect(status.listening).toBe(true);
    });

    it('should bound duration to 24 hours', () => {
      // Simulate very long session
      session.startedAt = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
      
      const status = session.getStatus();
      expect(status.durationMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    });
  });
});

describe('SessionManager', () => {
  let manager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  it('should create new session', () => {
    const session = manager.create();
    expect(session).toBeInstanceOf(Session);
    expect(manager.get(session.id)).toBe(session);
  });

  it('should create session with options', () => {
    const session = manager.create({ silenceThresholdMs: 30000 });
    expect(session.silenceThresholdMs).toBe(30000);
  });

  it('should get existing session', () => {
    const session = manager.create();
    const retrieved = manager.get(session.id);
    expect(retrieved).toBe(session);
  });

  it('should return null for non-existent session', () => {
    const retrieved = manager.get('non-existent-id');
    expect(retrieved).toBeNull();
  });

  it('should ensure session exists', () => {
    const session = manager.ensure('test-id');
    expect(session).toBeInstanceOf(Session);
    expect(session.id).toBe('test-id');
  });

  it('should return existing session on ensure', () => {
    const session = manager.create({ id: 'test-id' });
    const ensured = manager.ensure('test-id');
    expect(ensured).toBe(session);
  });
});
