# Blueprint: Daily Newsletter Send (Cron Job)

## Goal
Every morning, generate and send a personalized newsletter to every active subscriber at their chosen delivery time.

## Inputs Required
- Active subscribers from Supabase (fetched by cron)
- RSS feed content (fetched fresh each run)
- ANTHROPIC_API_KEY, RESEND_API_KEY, SUPABASE credentials in .env

## Scripts to Use
1. cron.js — main orchestrator, runs on schedule
2. scripts/fetch-rss.js — fetches and caches RSS feeds
3. scripts/generate-newsletter.js — builds prompt and calls Claude Haiku
4. scripts/send-email.js — sends via Resend and logs to DB

## Steps
1. Cron triggers at 2:00am EST
2. For each delivery time slot (6:00am through 9:00am in 30min intervals):
   a. Fetch all active subscribers with that delivery_time from Supabase
   b. Pre-fetch all RSS feeds needed for that batch (cache in memory)
   c. For each subscriber:
      - Map their topics to RSS feed URLs
      - Pull relevant cached stories
      - Build personalized prompt
      - Call Claude Haiku → get newsletter text
      - Convert to HTML (wrap in email template)
      - Send via Resend
      - Insert row into newsletters table (status: 'sent' or 'failed')
      - Update last_sent_at on subscriber
      - Add 200ms delay before next subscriber (rate limiting)
3. Log total sent/failed count at end of each slot

## Edge Cases
- RSS feed unreachable: skip that topic's stories, use others, log warning
- Claude API fails: retry 3x with backoff, if still failing mark status 'failed' and skip (don't send half-baked newsletter)
- Resend fails: retry once, log failure, don't mark last_sent_at
- Subscriber has no topics: shouldn't happen (frontend validates), but skip if it does
- Zero subscribers for a time slot: log and move on, no error

## Known Issues
- None yet
