# API Integration Skill — Morning Memo

## APIs Used in This Project
- **Anthropic (Claude Haiku)** — newsletter generation
- **Resend** — email delivery
- **RSS feeds** — news sourcing (no key required)
- **Supabase** — database (see supabase-database.md)

## Standard Error Handling
```javascript
async function fetchData(url) {
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
    return await response.json()
  } catch (error) {
    console.error('[API ERROR]', error)
    throw error
  }
}
```

## Retry with Exponential Backoff
Use this for Anthropic and Resend calls — both can occasionally timeout.
```javascript
async function fetchWithRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i === retries - 1) throw e
      const delay = 1000 * Math.pow(2, i)
      console.warn(`[RETRY] Attempt ${i + 1} failed, retrying in ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}
```

## Anthropic (Claude Haiku) — Newsletter Generation
```javascript
const Anthropic = require('@anthropic-ai/sdk')
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const message = await client.messages.create({
  model: 'claude-haiku-4-5-20251001',  // Always use Haiku — cheapest, fast enough
  max_tokens: 2048,
  messages: [{ role: 'user', content: prompt }]
})
const newsletter = message.content[0].text
```

## Resend — Email Sending
```javascript
const { Resend } = require('resend')
const resend = new Resend(process.env.RESEND_API_KEY)

const { data, error } = await resend.emails.send({
  from: 'Morning Memo <memo@yourdomain.com>',
  to: subscriberEmail,
  subject: `Your Morning Memo — ${formattedDate}`,
  html: newsletterHtml
})
if (error) throw new Error(`Resend failed: ${error.message}`)
```

## RSS Feed Parsing
```javascript
const Parser = require('rss-parser')
const parser = new Parser()

const feed = await parser.parseURL('https://feeds.reuters.com/reuters/topNews')
const stories = feed.items.slice(0, 5).map(item => ({
  title: item.title,
  summary: item.contentSnippet || item.content,
  link: item.link,
  date: item.pubDate
}))
```

## Rate Limiting
- Anthropic: add 200ms delay between subscriber generations in cron job
- Resend free tier: 3,000 emails/month — fine for early users
- RSS feeds: no limit, but cache results so you don't re-fetch per subscriber

## Don'ts
- NEVER hardcode API keys — always process.env
- NEVER use Claude Sonnet/Opus for newsletter generation (too expensive)
- NEVER log full newsletter content in production (storage/privacy)
- NEVER ignore rate limits
