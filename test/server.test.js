import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { SessionManager, SessionState } from '../src/session.js';

// Mock the OpenRouter client
const mockOpenRouterClient = {
  chat: jest.fn()
};

// Mock the session module
jest.mock('../src/session.js', () => ({
  SessionManager: jest.fn(() => ({
    create: jest.fn(),
    get: jest.fn(),
    ensure: jest.fn()
  })),
  SessionState: {
    IDLE: 'idle',
    LISTENING: 'listening',
    PROCESSING: 'processing',
    PAUSED: 'paused',
    ENDED: 'ended'
  }
}));

// Create a test server
const createTestServer = () => {
  const app = express();
  app.use(express.json());
  
  // Mock session manager
  const sessions = new SessionManager();
  
  // Health check
  app.get('/healthz', (req, res) => {
    res.json({ ok: true });
  });

  // Root endpoint
  app.get('/', (req, res) => {
    res.json({ name: 'nlp-therapy-ai', chat_endpoint: '/api/chat' });
  });

  // Session endpoints
  app.post('/api/session', (req, res) => {
    const session = sessions.create();
    res.json({ id: session.id, status: session.getStatus() });
  });

  app.post('/api/session/:id/start', (req, res) => {
    const session = sessions.ensure(req.params.id);
    session.start();
    res.json(session.getStatus());
  });

  app.post('/api/session/:id/pause', (req, res) => {
    const session = sessions.ensure(req.params.id);
    session.pause();
    res.json(session.getStatus());
  });

  app.post('/api/session/:id/end', (req, res) => {
    const session = sessions.ensure(req.params.id);
    session.end();
    res.json(session.getStatus());
  });

  app.post('/api/session/:id/billing/start', (req, res) => {
    const session = sessions.ensure(req.params.id);
    session.beginBilling();
    res.json(session.getStatus());
  });

  app.get('/api/session/:id', (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'not found' });
    session.tick();
    res.json(session.getStatus());
  });

  // Mock chat endpoint
  app.post('/api/chat', async (req, res) => {
    const { messages = [], task = null, model: explicitModel = null, sessionId = null } = req.body || {};
    
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
    }

    // Mock response
    const content = 'Mock AI response';
    const model = explicitModel || 'openai/gpt-4o-mini';
    
    if (sessionId) {
      const session = sessions.ensure(sessionId);
      session.addUserMessage(messages?.find(m => m.role === 'user')?.content || '');
      session.state = SessionState.PROCESSING;
      session.addAssistantMessage(content);
      session.state = SessionState.LISTENING;
      session.lastActivityAt = Date.now();
    }
    
    res.json({ content, model, sessionId });
  });

  return app;
};

describe('Server Endpoints', () => {
  let app;

  beforeEach(() => {
    app = createTestServer();
    process.env.OPENROUTER_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/healthz');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });
  });

  describe('Root Endpoint', () => {
    it('should return app info', async () => {
      const response = await request(app).get('/');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        name: 'nlp-therapy-ai',
        chat_endpoint: '/api/chat'
      });
    });
  });

  describe('Session Management', () => {
    it('should create new session', async () => {
      const response = await request(app).post('/api/session');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('status');
    });

    it('should start session', async () => {
      const createResponse = await request(app).post('/api/session');
      const sessionId = createResponse.body.id;
      
      const response = await request(app).post(`/api/session/${sessionId}/start`);
      expect(response.status).toBe(200);
      expect(response.body.state).toBe('listening');
    });

    it('should pause session', async () => {
      const createResponse = await request(app).post('/api/session');
      const sessionId = createResponse.body.id;
      
      const response = await request(app).post(`/api/session/${sessionId}/pause`);
      expect(response.status).toBe(200);
      expect(response.body.state).toBe('paused');
    });

    it('should end session', async () => {
      const createResponse = await request(app).post('/api/session');
      const sessionId = createResponse.body.id;
      
      const response = await request(app).post(`/api/session/${sessionId}/end`);
      expect(response.status).toBe(200);
      expect(response.body.state).toBe('ended');
    });

    it('should start billing', async () => {
      const createResponse = await request(app).post('/api/session');
      const sessionId = createResponse.body.id;
      
      const response = await request(app).post(`/api/session/${sessionId}/billing/start`);
      expect(response.status).toBe(200);
      expect(response.body.billing.active).toBe(true);
    });

    it('should get session status', async () => {
      const createResponse = await request(app).post('/api/session');
      const sessionId = createResponse.body.id;
      
      const response = await request(app).get(`/api/session/${sessionId}`);
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', sessionId);
      expect(response.body).toHaveProperty('state');
      expect(response.body).toHaveProperty('durationMs');
      expect(response.body).toHaveProperty('billing');
    });

    it('should return 404 for non-existent session', async () => {
      const response = await request(app).get('/api/session/non-existent-id');
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'not found' });
    });
  });

  describe('Chat Endpoint', () => {
    it('should handle chat request', async () => {
      const messages = [
        { role: 'user', content: 'Hello' }
      ];
      
      const response = await request(app)
        .post('/api/chat')
        .send({ messages });
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('content');
      expect(response.body).toHaveProperty('model');
    });

    it('should handle chat with session tracking', async () => {
      const createResponse = await request(app).post('/api/session');
      const sessionId = createResponse.body.id;
      
      const messages = [
        { role: 'user', content: 'Hello' }
      ];
      
      const response = await request(app)
        .post('/api/chat')
        .send({ messages, sessionId });
      
      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBe(sessionId);
    });

    it('should return 500 when API key not configured', async () => {
      delete process.env.OPENROUTER_API_KEY;
      
      const response = await request(app)
        .post('/api/chat')
        .send({ messages: [{ role: 'user', content: 'Hello' }] });
      
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'OPENROUTER_API_KEY not configured' });
    });
  });
});
