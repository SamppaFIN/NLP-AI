# NLP Therapy AI - Deployment Guide

## Quick Deploy to Heroku

### Prerequisites
- Heroku CLI installed
- Git repository initialized
- OpenRouter API key

### Steps

1. **Create Heroku App**
```bash
cd Projects/Processing/nlp-therapy-ai
heroku create your-nlp-therapy-ai
```

2. **Set Environment Variables**
```bash
heroku config:set OPENROUTER_API_KEY=sk-or-your-key-here
heroku config:set OPENROUTER_BASE=https://openrouter.ai/api/v1
heroku config:set OPENROUTER_MODEL=openai/gpt-4o-mini
heroku config:set HTTP_REFERER=https://your-nlp-therapy-ai.herokuapp.com
heroku config:set X_TITLE=NLP Therapy AI
```

3. **Deploy**
```bash
git add .
git commit -m "Initial NLP Therapy AI deployment"
git push heroku main
```

4. **Open App**
```bash
heroku open
```

## Local Development

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your OPENROUTER_API_KEY

# Run locally
npm start
# Visit http://localhost:3000
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | Your OpenRouter API key | Required |
| `OPENROUTER_BASE` | OpenRouter API base URL | `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL` | Default model to use | `openai/gpt-4o-mini` |
| `HTTP_REFERER` | Referer header for OpenRouter | `https://local.dev` |
| `X_TITLE` | Title header for OpenRouter | `NLP Therapy AI` |
| `PORT` | Server port (Heroku sets this) | `3000` |

## API Endpoints

- `GET /` - App info
- `GET /healthz` - Health check
- `POST /api/session` - Create new session
- `POST /api/session/:id/start` - Start session
- `POST /api/session/:id/pause` - Pause session
- `POST /api/session/:id/end` - End session
- `POST /api/session/:id/billing/start` - Start billing
- `GET /api/session/:id` - Get session status
- `POST /api/chat` - Send chat message

## Features Implemented

✅ Session state machine (idle, listening, processing, paused)  
✅ Real-time session timer with bounded duration  
✅ Billing state tracking and indicators  
✅ Silence detection and empathetic handling  
✅ Conversational controls (pause/resume, skip, repeat)  
✅ Progress tracking UI with visual indicators  
✅ Lightweight SVG state icons  
✅ End-of-session summary and emotional feedback  
✅ OpenRouter integration with model routing  
✅ Heroku-ready deployment configuration  

## Troubleshooting

**Session not found (404)**
- Ensure session ID is valid UUID format
- Check if session was created before accessing

**OpenRouter errors**
- Verify API key is set correctly
- Check model name is valid
- Ensure sufficient credits

**Timer shows incorrect duration**
- Session timer is bounded to 24 hours max
- Billing timer only counts when billing is active
- Check for timezone issues

**Silence detection not working**
- Default threshold is 15 seconds
- Only active during 'listening' state
- Check `silenceMs` in session status
