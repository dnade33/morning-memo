# Project: Morning Memo

## What This Is
Morning Memo is a personalized daily newsletter product. Users complete a detailed onboarding survey selecting their interests (sports, finance, politics, etc.) with deep-dive preferences (specific teams, stocks, regions). Every morning a cron job fetches relevant news, generates a custom newsletter per subscriber using an LLM, and sends it via email at their chosen delivery time.

**Target demographic:** Boomers / older adults who want a curated, easy-to-read morning briefing.

## Core Principle
You operate as the decision-maker in a modular system. Your job is NOT to do everything yourself. Your job is to read instructions, pick the right tools, handle errors intelligently, and improve the system over time.

Why? 90% accuracy across 5 steps = 59% total success. Push repeatable work into tested scripts. You focus on decisions.

## System Architecture

**Blueprints (/blueprints)** - Step-by-step instructions in markdown. Goal, inputs, scripts to use, output, edge cases. Check here FIRST.

**Scripts (/scripts)** - Tested, deterministic code. Call these instead of writing from scratch.

**Workspace (/.workspace)** - Temp files. Never commit. Delete anytime.

## Tech Stack
- **Frontend:** Vanilla HTML/CSS/JS (morning-memo-combined.html) — no framework
- **Backend:** Node.js + Express
- **Database:** Supabase (PostgreSQL)
- **Email:** Resend API
- **LLM:** Claude Haiku via Anthropic API (cheap, fast, good enough for newsletter generation)
- **News:** RSS feeds + NewsAPI (free tier) — NOT frontier LLM web scraping
- **Cron:** node-cron for local dev, Vercel cron jobs in production
- **Deployment:** Vercel (API) + static hosting for HTML

## Cost Constraints — IMPORTANT
This was carefully designed to be cheap:
- Use **Claude Haiku** (not Sonnet/Opus) — ~$0.05-0.10/user/month vs $5+
- Use **RSS feeds** for news sourcing, not LLM web browsing
- Use **Resend free tier** (3,000 emails/month) for early users
- Target margin: 99%+ at $10/month pricing

Never suggest switching to a more expensive LLM or paid news API without flagging the cost impact.

## Survey Data Structure
The HTML survey collects and POSTs this payload to `POST /api/subscribe`:

```json
{
  "name": "Richard",
  "email": "richard@example.com",
  "topics": ["Sports", "Finance", "World News", "Local Weather"],
  "city": "Phoenix, AZ, USA",
  "tagAnswers": {
    "sports-leagues": ["NFL", "NBA"],
    "sub-sports-leagues-nfl": ["Chiefs", "Eagles"],
    "sub-sports-leagues-nba": ["Lakers"],
    "finance-areas": ["Stock Market", "Crypto & Digital Assets"],
    "sub-finance-areas-stock-market": ["S&P 500", "Apple (AAPL)"],
    "news-regions": ["United States", "Europe"],
    "health-areas": ["Fitness & Exercise", "Longevity & Aging"]
  },
  "time": "7:00am",
  "quoteStyle": "Stoic",
  "extra": "I love stories about space exploration"
}
```

## Project Structure
```
/
├── morning-memo-combined.html   ← Full landing page + survey (already built)
├── server.js                    ← Express API (POST /api/subscribe)
├── schema.sql                   ← Supabase DB schema
├── cron.js                      ← Daily newsletter generation + sending
├── /scripts                     ← Reusable automation scripts
├── /blueprints                  ← Task SOPs
├── /.workspace                  ← Temp files (gitignored)
├── CLAUDE.md                    ← This file
├── LEARNINGS.md                 ← Errors and solutions log
├── .env                         ← Secrets (never commit)
├── .env.example                 ← Template
├── .gitignore
└── package.json
```

## Database Schema (Supabase)
Two tables:

**subscribers**
- id, created_at, first_name, email (unique), topics (text[]), city, preferences (jsonb), delivery_time, quote_style, extra_notes, active, last_sent_at

**newsletters**
- id, sent_at, subscriber_id (FK), subject, body_html, delivery_time, status

## Cron Job Architecture
Runs nightly ~2-3am EST. For each delivery time slot (6:00am, 6:30am, ... 9:00am):
1. Fetch all active subscribers with that delivery_time from Supabase
2. For each subscriber:
   - Map their topics/preferences → RSS feed URLs
   - Fetch and parse RSS feeds
   - Build a prompt with their preferences + fetched stories
   - Call Claude Haiku to generate the newsletter
   - Send via Resend
   - Log to newsletters table
   - Update last_sent_at

## Newsletter Generation Prompt Pattern
- Strong persona: warm, knowledgeable curator named "Your Morning Memo Editor"
- Inject user's name, topics, specific preferences naturally
- Format: greeting → 5-6 stories with headlines + 2-3 sentence summaries → closing quote (based on quoteStyle preference)
- Tone: clear, no jargon, friendly — written for an older demographic
- Include few-shot examples in the system prompt for consistency

## RSS Feed Mapping
Topics map to feed URLs:
- Sports/NFL → ESPN NFL RSS, NFL.com feed
- Finance/Stock Market → Yahoo Finance, MarketWatch
- World News → Reuters, AP News
- Politics → Politico, The Hill
- Science → Science Daily, NASA
- Health → WebMD, NIH News
- Technology → TechCrunch, Wired
- etc.

## Code Standards
- JavaScript (not TypeScript) — keep it simple for a solo project
- Async/await over .then()
- Always check Supabase errors before using data
- Never hardcode API keys — always use process.env
- Add console.log checkpoints in cron job for easy debugging

## Error Protocol
1. Stop and read the full error
2. Isolate — which component/script failed
3. Fix and test
4. Document in LEARNINGS.md
5. Update relevant blueprint

## What NOT To Do
- Don't skip blueprint check
- Don't use expensive LLMs (Sonnet/Opus/GPT-4) for newsletter generation
- Don't ignore Supabase errors
- Don't create files outside the structure
- Don't write from scratch when a blueprint exists
- Don't expose SUPABASE_SERVICE_KEY to the client/frontend
