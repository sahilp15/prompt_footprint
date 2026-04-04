# PromptFootprint

A Chrome extension that passively tracks ChatGPT interactions and estimates their environmental impact — energy (Wh), water (mL), and CO₂ (g) — using a peer-reviewed token-level framework.

## Architecture

```
Prompt-Footprint/
├── manifest.json          Chrome extension manifest (MV3)
├── extension/             Chrome extension source (vanilla JS)
│   ├── background.js      Service worker
│   ├── content.js         ChatGPT DOM observer
│   ├── popup/             Extension popup UI
│   ├── overlay/           Floating + modal overlays on ChatGPT
│   ├── dashboard/         Options page (session history)
│   ├── lib/               Shared logic (env model, API client, token estimator)
│   └── styles/            Shared design system CSS
├── server/                Node.js + Express + PostgreSQL backend
└── stats-site/            React + Vite stats website
```

## Environmental Model

Based on: *"A Token-Level Framework for Quantifying ChatGPT's Environmental Impacts"* by Sahil Parasharami, using OpenAI's 2025 Sustainability Disclosure.

**Token estimation:** `tokens = ceil(word_count × 1.3)` (GPT-4o BPE heuristic)

**Per 1,000 tokens (GPT-4o):**
- Energy: ~1.065 Wh
- Water: ~3.54 mL
- CO₂: ~0.375 g

**GPT-5 scaling multipliers:** 1.9× (minimal reasoning) → 14× (high reasoning)

## Setup

### 1. Backend Server

```bash
cd server
cp .env.example .env
# Edit .env with your PostgreSQL DATABASE_URL
npm install
npm start
```

Server runs on `http://localhost:3001`

### 2. Stats Website

```bash
cd stats-site
npm install
npm run dev
```

Runs on `http://localhost:5173`

### 3. Chrome Extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the **repo root** directory (where `manifest.json` lives)

## Usage

1. Start the backend server
2. Load the extension in Chrome
3. Navigate to [chatgpt.com](https://chatgpt.com)
4. Send a message — the extension auto-detects prompts and responses
5. Click the floating **PF** pill (bottom-left) to open the modal with per-query metrics
6. Click the extension icon for popup controls
7. Click **View Full Stats** to open the stats website

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sessions` | Create a new session |
| GET | `/api/sessions?userId=X` | Get all sessions for a user |
| GET | `/api/sessions/weekly?userId=X` | Weekly aggregated stats |
| PATCH | `/api/sessions/:id` | Update session (end time, totals) |
| POST | `/api/queries` | Log a query |
| GET | `/api/queries?sessionId=X` | Get queries for a session |
| GET | `/api/config?userId=X` | Get user config |
| PUT | `/api/config` | Update user config |

## Data Privacy

- **No prompt or response text is ever stored** — only token counts and computed metrics
- Each user gets an anonymous UUID generated on first install
- All persistent data lives in the remote backend database

## Deployment

The backend can be deployed to Railway, Render, Fly.io, or any Node.js host. Set `DATABASE_URL` to your production PostgreSQL URL.

The stats site builds to a static bundle (`npm run build`) deployable to Vercel, Netlify, or any static host.

Update `API_BASE_URL` in `extension/lib/apiClient.js` and `stats-site/src/lib/api.js` to point to your production backend before publishing the extension.
