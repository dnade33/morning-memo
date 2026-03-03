// Morning Memo — Newsletter generation via Claude Haiku
const Anthropic = require('@anthropic-ai/sdk')
const { logger } = require('../logger')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ----------------------------------------------------------------
// Quote style resolver
// ----------------------------------------------------------------
const QUOTE_STYLES = [
  'Inspirational', 'Philosophical', 'Stoic', 'Humor & Wit',
  'Historical', 'Literary', 'Science & Discovery'
]

function resolveQuoteStyle(style) {
  if (style === 'Surprise Me') {
    return QUOTE_STYLES[Math.floor(Math.random() * QUOTE_STYLES.length)]
  }
  return style
}

// ----------------------------------------------------------------
// Prompt builder — passes stories grouped by topic
// Uses custom markers so the response is reliably parseable
// ----------------------------------------------------------------
function buildPrompt(subscriber, topicStories, quoteStyle) {
  const topicBlocks = topicStories.map(({ topic, stories }) => {
    const subtopics = subscriber.preferences?.[topic]
    const subtopicLine = subtopics && subtopics.length > 0
      ? `  Subscriber's specific interests within ${topic}: ${subtopics.join(', ')}`
      : ''
    const storyList = stories
      .slice(0, 6)
      .map((s, i) => `  Story ${i + 1}:\n  Title: ${s.title}\n  Summary: ${s.summary}${s.link ? `\n  Link: ${s.link}` : ''}`)
      .join('\n\n')
    return `TOPIC: ${topic}${subtopicLine ? `\n${subtopicLine}` : ''}\n${storyList}`
  }).join('\n\n---\n\n')

  return `You are the editor of Morning Memo, a sharp, intelligent daily briefing.
Write a personalized newsletter for ${subscriber.first_name}.

${subscriber.city ? `Their city: ${subscriber.city}` : ''}
${subscriber.extra_notes ? `Personal note from subscriber: "${subscriber.extra_notes}"` : ''}

Today's stories, organized by topic:
${topicBlocks}

Format your response using EXACTLY these markers — do not deviate:

[GREETING]
One or two sharp, warm sentences greeting ${subscriber.first_name} by name. Keep it personal and energizing — no weather references.

[TOPIC: TopicNameHere]
[HEADLINE]Headline text here[/HEADLINE]
2-3 sentence summary in plain, clear English.
[LINK]paste-the-original-link-url-here[/LINK]

[HEADLINE]Second headline here[/HEADLINE]
2-3 sentence summary.
[LINK]paste-the-original-link-url-here[/LINK]

(repeat [TOPIC: ...] blocks for each topic)

[QUOTE]
"Quote text here."
— Attribution Name

Rules:
- Use the exact markers: [GREETING], [TOPIC: X], [HEADLINE], [/HEADLINE], [LINK], [/LINK], [QUOTE]
- For [TOPIC: X], X must be the exact topic name given in the prompt (e.g. "World News", "Finance", "Sports"). Never use a subtopic or story subject as the topic name.
- After each story summary, copy the original Link URL into a [LINK]...[/LINK] marker. If no link was provided, omit the marker.
- When a topic lists the subscriber's specific interests, prioritize stories that touch those subtopics and explicitly weave those angles into your summaries — make the subscriber feel the newsletter was written just for them.
- Write 2-3 stories per topic. All stories for a topic go under a single [TOPIC: X] block — do not split a topic into multiple blocks.
- Tone: sharp, intelligent, like a briefing document
- Quote style: ${quoteStyle}
- Plain text only inside the markers — no markdown asterisks, no bullet points`
}

// ----------------------------------------------------------------
// Parse Claude's structured response into sections
// ----------------------------------------------------------------
function parseNewsletterContent(text) {
  const result = { greeting: '', topics: [], quote: null }

  // Extract greeting
  const greetingMatch = text.match(/\[GREETING\]([\s\S]*?)(?=\[TOPIC:|$)/)
  if (greetingMatch) result.greeting = greetingMatch[1].trim()

  // Extract topics (everything between [TOPIC: X] and next [TOPIC:] or [QUOTE])
  const topicRegex = /\[TOPIC:\s*([^\]]+)\]([\s\S]*?)(?=\[TOPIC:|$|\[QUOTE\])/g
  let topicMatch
  while ((topicMatch = topicRegex.exec(text)) !== null) {
    const topicName = topicMatch[1].trim()
    const topicContent = topicMatch[2].trim()

    // Extract stories within this topic
    const stories = []
    const storyRegex = /\[HEADLINE\]([\s\S]*?)\[\/HEADLINE\]([\s\S]*?)(?=\[HEADLINE\]|$)/g
    let storyMatch
    while ((storyMatch = storyRegex.exec(topicContent)) !== null) {
      const rawBody = storyMatch[2].trim()
      if (rawBody) {
        const linkMatch = rawBody.match(/\[LINK\](https?:\/\/[^\s\[\]]+)/)
        const link = linkMatch ? linkMatch[1].trim() : ''
        const body = rawBody.replace(/\[LINK\][\s\S]*?(?:\[\/LINK\]|$)/, '').trim()
        stories.push({ headline: storyMatch[1].trim(), body, link })
      }
    }

    if (stories.length > 0) {
      result.topics.push({ name: topicName, stories })
    }
  }

  // Extract closing quote
  const quoteMatch = text.match(/\[QUOTE\]([\s\S]*)$/)
  if (quoteMatch) {
    const quoteContent = quoteMatch[1].trim()
    const lines = quoteContent.split('\n').map(l => l.trim()).filter(Boolean)
    const quoteLine = lines[0] || ''
    const attrLine = lines[1] || ''
    result.quote = {
      text: quoteLine.replace(/^[""\u201c]|[""\u201d]$/g, '').trim(),
      attribution: attrLine.replace(/^—\s*/, '').trim()
    }
  }

  return result
}

// ----------------------------------------------------------------
// Escape HTML entities
// ----------------------------------------------------------------
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ----------------------------------------------------------------
// Build Mission Control terminal email HTML
// ----------------------------------------------------------------
const TOPIC_EMOJIS = {
  'Sports': '⚽', 'NFL': '🏈', 'NBA': '🏀', 'MLB': '⚾', 'NHL': '🏒',
  'College Football': '🏈', 'College Basketball': '🏀', 'Soccer / MLS': '⚽', 'Golf': '⛳',
  'World News': '🌍', 'Politics': '🏛️', 'Finance': '📈', 'Technology': '💻',
  'Science': '🔬', 'Health': '❤️', 'Arts & Culture': '🎨', 'Food & Travel': '🍽️',
  'History': '🏛', 'Books & Ideas': '📚', 'Local Weather': '🌤️'
}

function buildMissionControlEmail(parsed, formattedDate, prefToken = null) {
  const mono = `'JetBrains Mono','IBM Plex Mono','Courier New',monospace`
  const sans = `'Space Grotesk','Segoe UI',Arial,sans-serif`

  // Build topic panel HTML — stories stacked vertically, full width
  const topicPanelsHtml = parsed.topics.map(({ name, stories }) => {
    const storyRows = stories.map((story, i) => {
      const borderTop = i > 0 ? 'border-top:1px solid rgba(255,255,255,0.06);' : ''
      const isWeatherLink = story.link && story.link.includes('wttr.in')
      const readMoreLink = story.link && !isWeatherLink
        ? `<p style="margin:8px 0 0;font-family:${mono};font-size:10px;letter-spacing:1.5px;"><a href="${esc(story.link)}" style="color:#00d4ff;text-decoration:none;text-transform:uppercase;">Go Deeper &rarr;</a></p>`
        : ''
      return `<tr>
        <td style="padding:16px 20px;${borderTop}">
          <p style="margin:0 0 8px;font-family:${mono};font-size:12px;font-weight:700;color:#dde2ed;letter-spacing:0.3px;line-height:1.4;">${esc(story.headline)}</p>
          <p style="margin:0;font-family:${sans};font-size:13px;line-height:1.75;color:#a8b8cc;font-weight:300;">${esc(story.body)}</p>
          ${readMoreLink}
        </td>
      </tr>`
    }).join('')

    return `
      <tr>
        <td style="padding:6px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid rgba(255,255,255,0.07);border-radius:2px;">
            <tr>
              <td style="background:rgba(0,212,255,0.05);border-bottom:1px solid rgba(0,212,255,0.15);padding:8px 18px;">
                <p style="margin:0;font-family:${mono};font-size:10px;letter-spacing:3px;color:#00d4ff;text-transform:uppercase;">${TOPIC_EMOJIS[name] ? TOPIC_EMOJIS[name] + ' ' : ''}${esc(name)}</p>
              </td>
            </tr>
            ${storyRows}
          </table>
        </td>
      </tr>`
  }).join('')

  // Build quote panel HTML
  const quotePanelHtml = parsed.quote ? `
    <tr>
      <td style="padding:6px 20px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-left:2px solid #00d4ff;">
          <tr>
            <td style="padding:12px 18px;">
              <p style="margin:0 0 4px;font-family:${mono};font-size:10px;letter-spacing:3px;color:#00d4ff;text-transform:uppercase;">Today's Quote</p>
              <p style="margin:10px 0 0;font-family:${sans};font-size:14px;line-height:1.75;color:#dde2ed;font-style:italic;font-weight:300;">&ldquo;${esc(parsed.quote.text)}&rdquo;</p>
              <p style="margin:8px 0 0;font-family:${mono};font-size:11px;color:#6b7fa0;letter-spacing:1px;">&mdash; ${esc(parsed.quote.attribution)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>` : ''

  // Split "Good morning, Name." from the rest so we can color it separately
  const greetingRaw = parsed.greeting
  const greetingMatch = greetingRaw.match(/^(Good\s+morning[,\s]+[^.!?]+[.!?]?\s*)/i)
  const greetingBlue = greetingMatch ? greetingMatch[1].trimEnd() : ''
  const greetingRest = greetingMatch ? greetingRaw.slice(greetingBlue.length) : greetingRaw

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Morning Memo</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@300;400;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#0d1524;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1524;padding:32px 12px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;background:#111827;border:1px solid rgba(255,255,255,0.07);">

          <!-- ── MASTHEAD ── -->
          <tr>
            <td align="center" style="padding:28px 20px 22px;border-bottom:1px solid rgba(255,255,255,0.08);">
              <p style="margin:0;font-family:${mono};font-size:22px;font-weight:700;color:#dde2ed;letter-spacing:0.05em;">Morning<span style="color:#00d4ff;">Memo</span></p>
              <p style="margin:8px 0 0;font-family:${mono};font-size:10px;letter-spacing:3px;color:#6b7fa0;text-transform:uppercase;">${esc(formattedDate)}</p>
            </td>
          </tr>

          <!-- ── GREETING ── -->
          <tr>
            <td style="padding:20px 20px 12px;">
              <p style="margin:0;font-family:${sans};font-size:14px;line-height:1.75;color:#a8b8cc;font-weight:300;"><span style="color:#00d4ff;">${esc(greetingBlue)}</span>${esc(greetingRest)}</p>
            </td>
          </tr>

          <!-- ── DIVIDER ── -->
          <tr>
            <td style="padding:0 20px 6px;">
              <div style="height:1px;background:rgba(255,255,255,0.06);"></div>
            </td>
          </tr>

          <!-- ── TOPIC PANELS ── -->
          ${topicPanelsHtml}

          <!-- ── QUOTE ── -->
          ${quotePanelHtml}

          <!-- ── FOOTER ── -->
          <tr>
            <td style="border-top:1px solid rgba(255,255,255,0.06);padding:20px;text-align:center;">
              <p style="margin:0 0 8px;font-family:${mono};font-size:11px;font-weight:700;color:#dde2ed;letter-spacing:0.05em;">Morning<span style="color:#00d4ff;">Memo</span></p>
              <p style="margin:0 0 12px;font-family:${sans};font-size:12px;color:#6b7fa0;line-height:1.6;">
                You're receiving this because you subscribed to Morning Memo.
              </p>
              ${prefToken ? `
              <a href="${process.env.APP_URL || 'http://localhost:3001'}/preferences.html?token=${prefToken}" style="font-family:${mono};font-size:10px;letter-spacing:2px;color:#00d4ff;text-decoration:underline;text-transform:uppercase;"><span style="color:#00d4ff;">Update Preferences</span></a>
              &nbsp;&nbsp;&middot;&nbsp;&nbsp;
              <a href="${process.env.APP_URL || 'http://localhost:3001'}/unsubscribe.html?token=${prefToken}" style="font-family:${mono};font-size:10px;letter-spacing:2px;color:#a8b8cc;text-decoration:underline;text-transform:uppercase;"><span style="color:#a8b8cc;">Unsubscribe</span></a>
              ` : ''}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ----------------------------------------------------------------
// Retry helper (exponential backoff)
// ----------------------------------------------------------------
async function fetchWithRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i === retries - 1) throw e
      const delay = 1000 * Math.pow(2, i)
      logger.warn(`[RETRY] Claude attempt ${i + 1} failed, retrying in ${delay}ms`, e.message)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

// ----------------------------------------------------------------
// Main export: generate a newsletter for one subscriber
//
// topicStories: array of { topic, stories[] } from fetch-rss.js
// Returns: { subject, body_html }
// ----------------------------------------------------------------
async function generateNewsletter(subscriber, topicStories) {
  if (!topicStories || topicStories.length === 0) {
    throw new Error(`No stories available for subscriber ${subscriber.id} — cannot generate newsletter`)
  }

  const quoteStyle = resolveQuoteStyle(subscriber.quote_style)
  const prompt = buildPrompt(subscriber, topicStories, quoteStyle)

  const rawText = await fetchWithRetry(async () => {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    })
    return message.content[0].text
  })

  const parsed = parseNewsletterContent(rawText)

  // Re-merge any panels Claude incorrectly named after a subtopic instead of the parent topic.
  // Build subtopic → parent lookup from subscriber preferences, then remap parsed topic names.
  const validTopicNames = new Set(topicStories.map(t => t.topic))
  const subtopicToParent = {}
  for (const { topic } of topicStories) {
    for (const sub of (subscriber.preferences?.[topic] || [])) {
      subtopicToParent[sub.toLowerCase()] = topic
    }
  }
  const mergedTopicMap = {}
  for (const parsedTopic of parsed.topics) {
    const parent = validTopicNames.has(parsedTopic.name)
      ? parsedTopic.name
      : (subtopicToParent[parsedTopic.name.toLowerCase()] || parsedTopic.name)
    if (!mergedTopicMap[parent]) mergedTopicMap[parent] = { name: parent, stories: [] }
    mergedTopicMap[parent].stories.push(...parsedTopic.stories)
  }
  parsed.topics = Object.values(mergedTopicMap)

  // Fallback: if parsing found no topics, log and use raw text in a single panel
  if (parsed.topics.length === 0) {
    logger.warn(`Newsletter parsing found no topic sections for ${subscriber.email} — using raw fallback`)
    parsed.topics = [{ name: 'Today\'s Briefing', stories: [{ headline: 'Your Morning Summary', body: rawText }] }]
  }

  const now = new Date()
  const formattedDate = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })

  const subject = `Your Morning Memo — ${formattedDate}`
  const body_html = buildMissionControlEmail(parsed, formattedDate, subscriber.pref_token)

  // Collect all story links included in this newsletter for deduplication tracking
  const sentLinks = parsed.topics
    .flatMap(t => t.stories.map(s => s.link))
    .filter(Boolean)

  return { subject, body_html, sentLinks }
}

// ----------------------------------------------------------------
// Exports
// ----------------------------------------------------------------
module.exports = { generateNewsletter, buildMissionControlEmail, parseNewsletterContent }
