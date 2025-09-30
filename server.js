import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';
import { SessionManager, SessionState } from './src/session.js';

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
app.use(express.json());
const sessions = new SessionManager();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
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

app.post('/api/chat', async (req, res) => {
  const { messages = [], task = null, model: explicitModel = null, sessionId = null } = req.body || {};
  const apiKey = process.env.OPENROUTER_API_KEY || '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';
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
    const status = err?.response?.status || 502;
    res.status(status).json({ error: 'Upstream error', detail: err?.message || String(err) });
  }
});

// Generate session summary using OpenRouter
app.post('/api/summary', async (req, res) => {
  const { sessionId } = req.body || {};
  const apiKey = process.env.OPENROUTER_API_KEY || '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';
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


