import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';
import { SessionManager, SessionState } from './src/session.js';

// Simple in-memory rate limiter
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute per IP

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }
  
  const requests = rateLimitMap.get(ip);
  const validRequests = requests.filter(time => now - time < RATE_LIMIT_WINDOW);
  
  if (validRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ error: 'Too many requests, please try again later' });
  }
  
  validRequests.push(now);
  rateLimitMap.set(ip, validRequests);
  next();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadPolicy() {
  const policyPath = process.env.OPENROUTER_POLICY || path.resolve(__dirname, '../../openrouter-policy.yml');
  try {
    const raw = fs.readFileSync(policyPath, 'utf-8');
    return yaml.load(raw) || {};
  } catch {
    return {};
  }
}

function routeModelForTask(policy, task) {
  const tiers = policy.tiers || [];
  for (const tier of tiers) {
    if ((tier.use_for || []).includes(task)) {
      const models = tier.models || [];
      if (models.length > 0) return models[0];
    }
  }
  if (tiers.length > 0 && (tiers[0].models || []).length > 0) return tiers[0].models[0];
  return null;
}

const app = express();
app.use(express.json({ limit: '10mb' })); // Add size limit
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Add URL encoding support
const sessions = new SessionManager();
app.use(express.static(path.join(__dirname, 'public')));

// Add CORS middleware for security
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGINS || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.get('/healthz', (req, res) => {
  const health = {
    ok: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '0.1.0',
    environment: process.env.NODE_ENV || 'development'
  };
  res.json(health);
});

app.get('/', (req, res) => {
  res.json({ name: 'nlp-therapy-ai', chat_endpoint: '/api/chat' });
});

// Session endpoints
app.post('/api/session', (req, res) => {
  const s = sessions.create();
  res.json({ id: s.id, status: s.getStatus() });
});

app.post('/api/session/:id/start', (req, res) => {
  const s = sessions.ensure(req.params.id);
  s.start();
  res.json(s.getStatus());
});

app.post('/api/session/:id/pause', (req, res) => {
  const s = sessions.ensure(req.params.id);
  s.pause();
  res.json(s.getStatus());
});

app.post('/api/session/:id/end', (req, res) => {
  const s = sessions.ensure(req.params.id);
  s.end();
  res.json(s.getStatus());
});

app.post('/api/session/:id/billing/start', (req, res) => {
  const s = sessions.ensure(req.params.id);
  s.beginBilling();
  res.json(s.getStatus());
});

app.get('/api/session/:id', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  s.tick();
  res.json(s.getStatus());
});

app.post('/api/chat', rateLimit, async (req, res) => {
  const { messages = [], task = null, model: explicitModel = null, sessionId = null } = req.body || {};
  
  // Input validation - more lenient for better UX
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages must be an array' });
  }
  
  // Allow empty messages for initial requests
  if (messages.length === 0) {
    return res.status(400).json({ error: 'At least one message is required' });
  }
  
  // Validate message structure - more lenient
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') {
      return res.status(400).json({ error: 'Each message must be an object' });
    }
    if (!msg.role || !msg.content) {
      return res.status(400).json({ error: 'Each message must have role and content fields' });
    }
    if (!['system', 'user', 'assistant'].includes(msg.role)) {
      return res.status(400).json({ error: 'Message role must be system, user, or assistant' });
    }
    if (typeof msg.content !== 'string') {
      return res.status(400).json({ error: 'Message content must be a string' });
    }
    if (msg.content.length > 50000) {
      return res.status(400).json({ error: 'Message content too long (max 50000 characters)' });
    }
  }
  
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });

  const base = (process.env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const policy = loadPolicy();
  const resolvedModel = explicitModel || (task ? routeModelForTask(policy, task) : null) || process.env.OPENROUTER_MODEL;
  if (!resolvedModel) return res.status(400).json({ error: 'Model not resolvable. Set OPENROUTER_MODEL or policy.' });

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'HTTP-Referer': process.env.HTTP_REFERER || 'https://local.dev',
    'X-Title': process.env.X_TITLE || 'NLP Therapy AI',
    'Content-Type': 'application/json'
  };
  const payload = { model: resolvedModel, messages };

  try {
    // track session activity and empathy for silence
    if (sessionId) {
      const s = sessions.ensure(sessionId);
      s.addUserMessage(messages?.find(m => m.role === 'user')?.content || '');
      s.state = SessionState.PROCESSING;
    }
    const resp = await axios.post(`${base}/chat/completions`, payload, { headers, timeout: 60000 });
    const content = resp?.data?.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error: 'Upstream returned empty content' });
    if (sessionId) {
      const s = sessions.ensure(sessionId);
      s.addAssistantMessage(content);
      s.state = SessionState.LISTENING;
      s.lastActivityAt = Date.now();
    }
    res.json({ content, model: resolvedModel, sessionId });
  } catch (err) {
    console.error('Chat API error:', err);
    const status = err?.response?.status || 502;
    const errorMessage = err?.response?.data?.error?.message || err?.message || 'Unknown error';
    res.status(status).json({ 
      error: 'Upstream error', 
      detail: errorMessage,
      timestamp: new Date().toISOString()
    });
  }
});

// Generate session summary using OpenRouter
app.post('/api/summary', async (req, res) => {
  const { sessionId } = req.body || {};
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'session not found' });

  const base = (process.env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const policy = loadPolicy();
  const resolvedModel = routeModelForTask(policy, 'docs') || process.env.OPENROUTER_MODEL;
  if (!resolvedModel) return res.status(400).json({ error: 'Model not resolvable. Set OPENROUTER_MODEL or policy.' });

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'HTTP-Referer': process.env.HTTP_REFERER || 'https://local.dev',
    'X-Title': process.env.X_TITLE || 'NLP Therapy AI',
    'Content-Type': 'application/json'
  };

  const transcript = (s.history || []).map(h => `${h.role.toUpperCase()}: ${h.content}`).join('\n');
  const systemPrompt = 'You are an empathetic therapist assistant. Generate a concise, supportive session summary: key insights, emotional tone, gentle next steps, and optional resources. Use clear, non-clinical language.';
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Here is the session transcript. Summarize it for the client.\n\n${transcript}` }
  ];

  try {
    const resp = await axios.post(`${base}/chat/completions`, { model: resolvedModel, messages }, { headers, timeout: 60000 });
    const content = resp?.data?.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error: 'Upstream returned empty content' });
    res.json({ summary: content, model: resolvedModel });
  } catch (err) {
    const status = err?.response?.status || 502;
    res.status(status).json({ error: 'Upstream error', detail: err?.message || String(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`nlp-therapy-ai listening on :${port}`);
});


