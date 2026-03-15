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
// ----------------------------------------------------------------
// Story allocation: min 6 total, max 10.
// ≥6 topics → 1 per topic. <6 topics → fill to 6 by giving extra
// stories to topics with the most subtopics selected.
// ----------------------------------------------------------------
function calculateStoryAllocation(subscriber, topicStories) {
  const MAX_STORIES = 8
  const allocation = {}

  // If more panels than max, only include the first MAX_STORIES panels
  const cappedTopics = topicStories.slice(0, MAX_STORIES)
  for (const { topic } of cappedTopics) allocation[topic] = 1

  if (cappedTopics.length < 6) {
    let remaining = 6 - cappedTopics.length
    const sorted = [...cappedTopics].sort((a, b) =>
      (subscriber.preferences?.[b.topic] || []).length -
      (subscriber.preferences?.[a.topic] || []).length
    )
    let i = 0
    while (remaining > 0) {
      allocation[sorted[i % sorted.length].topic]++
      remaining--
      i++
    }
  }

  return allocation
}

function buildPrompt(subscriber, topicStories, quoteStyle, allocation, recentTitles = [], recentQuotes = []) {
  const topicBlocks = topicStories.map(({ topic, stories }) => {
    const count = allocation[topic] || 1
    const subtopics = subscriber.preferences?.[topic]
    const subtopicLine = subtopics && subtopics.length > 0
      ? `  Subscriber's specific interests within ${topic}: ${subtopics.join(', ')}`
      : ''
    const storyList = stories
      .slice(0, 6)
      .map((s, i) => `  Story ${i + 1}:\n  Title: ${s.title}\n  Summary: ${s.summary}${s.link ? `\n  Link: ${s.link}` : ''}`)
      .join('\n\n')
    return `TOPIC: ${topic} [Write exactly ${count} ${count === 1 ? 'story' : 'stories'}]${subtopicLine ? `\n${subtopicLine}` : ''}\n${storyList}`
  }).join('\n\n---\n\n')

  const recentTitlesBlock = recentTitles.length > 0
    ? `Already sent to ${subscriber.first_name} in the last 2 days — do NOT cover these same events or ongoing sagas again today:\n${recentTitles.map(t => `- ${t}`).join('\n')}\n`
    : ''

  const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const subscriberTopics = topicStories.map(t => t.topic)
  const hasSports = subscriberTopics.some(t => t === 'Sports' || ['NFL','NBA','MLB','NHL','College Football','College Basketball','Soccer / MLS','Golf'].includes(t))

  return `You are the editor of Morning Memo, a warm, intelligent daily briefing written for an older audience.
Write a personalized newsletter for ${subscriber.first_name}.
Today's date: ${todayStr}
This subscriber's topics: ${subscriberTopics.join(', ')}

${hasSports ? `⚠ HARD RULE — SPORTS CONTAINMENT: This subscriber has a Sports panel. Sports stories (games, scores, trades, athletes, leagues, tournaments) are ONLY permitted inside the Sports panel. They are strictly forbidden in World News, Politics, Finance, or any other panel. A baseball game result is not World News. A trade is not Finance. A tournament bracket is not Politics. If a story is about a sport, it goes in Sports or gets skipped — no exceptions.\n` : `⚠ HARD RULE — NO SPORTS: This subscriber did NOT select Sports. Do not include any sports stories, game results, trades, athlete news, or league updates in any panel.\n`}
${subscriber.city ? `Their city: ${subscriber.city}` : ''}
${subscriber.extra_notes ? `Personal note from subscriber: "${subscriber.extra_notes}"` : ''}
${recentTitlesBlock}
Today's stories, organized by topic:
${topicBlocks}

Format your response using EXACTLY these markers — do not deviate:

[GREETING]
Two sentences. The first greets ${subscriber.first_name} by name — warm and energizing, no weather references. The second is a punchy teaser that previews 2-3 of the actual stories appearing below — like a friend giving you a quick heads-up on what's in today's memo. Only reference stories that genuinely appear in today's newsletter. Never invent or allude to content that isn't there.
  WRONG: "The Devils are in trouble tonight." — if there is no Devils story below, do not say this.
  RIGHT: "The Senators pulled off a stunner, markets are jittery ahead of the Fed decision, and there's a wild story out of Italy you won't want to miss."

[TOPIC: TopicNameHere]
[HEADLINE]Headline text here[/HEADLINE]
2-3 sentence summary in plain, clear English. Hard limit: 3 sentences maximum. No exceptions.
[LINK]paste-the-original-link-url-here[/LINK]

[HEADLINE]Second headline here[/HEADLINE]
2-3 sentence summary. Hard limit: 3 sentences maximum. No exceptions.
[LINK]paste-the-original-link-url-here[/LINK]

(repeat [TOPIC: ...] blocks for each topic)

[QUOTE]
"Quote text here."
— Attribution Name

═══ STRUCTURE RULES ═══
- Use the exact markers: [GREETING], [TOPIC: X], [HEADLINE], [/HEADLINE], [LINK], [/LINK], [QUOTE]
- For [TOPIC: X], X must be the exact topic name given in the prompt (e.g. "World News", "Finance", "Sports"). Never use a subtopic or story subject as the topic name.
- After each story summary, copy the original Link URL into a [LINK]...[/LINK] marker. If no link was provided, omit the marker.
- When a topic lists the subscriber's specific interests, prioritize those angles and weave them into your summaries — make the subscriber feel this was written just for them.
- Each topic block is labeled [Write exactly N stories]. Write exactly that many — no more, no fewer. No single subtopic may account for more than 2. Do not give each subtopic its own story budget.
- All stories for a topic go under one single [TOPIC: X] block — never split a topic into multiple blocks.
- The [QUOTE] section is mandatory and must ALWAYS appear at the end — no exceptions.

═══ THE CARDINAL RULE ═══
Every story panel must leave the reader genuinely more informed than the headline alone did. If someone reads only your summary and never clicks the link, they must still walk away knowing something real.

═══ THE LENGTH RULE ═══
Every story summary is capped at 3 sentences. Not 4. Not 5. 3. This is a morning briefing, not an essay. If you cannot make your point in 3 sentences, cut the least important sentence.

NEVER restate the headline. The summary must add information — start one level deeper: explain why, what it means, or what happens next.
  WRONG: "The Fed raised interest rates again as inflation concerns persist."
  RIGHT: "The Fed's quarter-point hike brings the benchmark rate to 5.5%, its highest level since 2001 — aimed at cooling stubborn services inflation, but mortgage rates are expected to climb further in response."

Headlines must answer "what happened?" not "what is this about?"
  WRONG: "Medicaid and the politics of health care and elections."
  RIGHT: "House Republicans Propose $880B Medicaid Cut Ahead of 2026 Midterms"

═══ CONTENT RULES ═══
- SPORTS: The panel header already tells the reader the sport — do NOT repeat it in the opening words of each summary (e.g. never write "In NBA basketball..." or "NFL football saw..."). Jump straight into the action. Always name both teams. Always include the final score for game recaps. Never say "the team" or "they" — use the team name. Always use the player's full name (first and last) on first reference. When covering a record or streak, always state the specific number — never leave it vague.
  WRONG: "Shai Gilgeous-Alexander tied a record set by Wilt Chamberlain over 60 years ago."
  RIGHT: "Shai Gilgeous-Alexander extended his streak of consecutive 20-point games to 53, tying a record Wilt Chamberlain set in 1962."
  WRONG: "In NBA basketball, Oklahoma City Thunder guard Shai Gilgeous-Alexander matched a record..."
  RIGHT: "Oklahoma City Thunder guard Shai Gilgeous-Alexander matched a record set by Wilt Chamberlain..."
  WRONG: "USA and Mexico meet as unbeaten teams heading into World Cup preparations on FOX tonight."
  RIGHT: "The U.S. men's soccer team hosts Mexico tonight at 8 p.m. ET on FOX in a World Cup warm-up match, with both nations entering undefeated and using the friendly to finalize their rosters before the tournament."

- FINANCE: Every finance or market story must include at least one concrete figure — a percentage, a price, a rate, or a dollar amount. Vague market commentary is not acceptable.
  WRONG: "Markets fell sharply on Wednesday amid recession fears."
  RIGHT: "The S&P 500 dropped 1.8% on Wednesday — its steepest single-day decline in three months — after weak manufacturing data reignited fears that the Fed's rate hikes are slowing the broader economy."

- FINANCE — TIME AWARENESS: Be precise about market timing. If a story covers Friday's session, futures reference Monday's open — not "the open." Never write "futures pointing to weakness at the open" after markets have already closed without specifying which day's open is meant.
  WRONG: "The Dow dropped 700 points during Friday's session, with futures pointing to further weakness at the open."
  RIGHT: "The Dow dropped 700 points on Friday, with futures suggesting Monday's open could see further losses."

- POLLS & SURVEYS: Whenever a story references a poll, survey, or public opinion finding, always include the specific percentage from the source. Never write "a majority," "most people," or "many Americans" — give the number. This applies to every topic, not just politics.
  WRONG: "A majority of Americans oppose military action against Iran."
  RIGHT: "62% of Americans oppose military action against Iran, according to a new poll."

- OPINION LABELING: If the source article is an opinion piece, editorial, or analysis column — rather than straight news reporting — begin the headline with "Opinion:" so the reader knows it is a viewpoint, not a factual report.
  WRONG: "Why Pulling Out of the Stock Market Right Now Would Be a Bad Idea"
  RIGHT: "Opinion: Why Pulling Out of the Stock Market Right Now Would Be a Bad Idea"

- POLITICS: Present both sides or stick to facts only. Never editorialize. Never use loaded language like "controversial" or "embattled" without factual grounding.
  WRONG: "The controversial bill passed despite fierce opposition from those who called it an attack on working families."
  RIGHT: "The bill passed 52-48. Supporters say it will reduce regulatory burdens and lower costs for small businesses. Opponents argue it weakens environmental protections and could cost an estimated 200,000 jobs."

- TITLES & ROLES: Use the title a person currently holds at the time of the article — do not rely on your training data for titles. If the source says "President Trump," write "President Trump." Never prepend "former" to a title unless the source explicitly says the person has left that role.

- FULL NAMES: Always use a person's full name (first and last) the first time they appear. Never refer to anyone by last name only. Never omit a person's name entirely and replace them with a vague description like "a key offensive lineman" or "a veteran player" — if the article names them, use that name.
  WRONG: "Mahomes threw for 340 yards in the Chiefs' win."
  WRONG: "The Cowboys lost a key offensive lineman to the Steelers." (if the article names the player, use the name)
  RIGHT: "Patrick Mahomes threw for 340 yards as the Kansas City Chiefs defeated the Buffalo Bills 27-21."

- ACRONYMS: The first time you use an acronym, spell it out in full with the acronym in parentheses: "The Organisation for Economic Co-operation and Development (OECD)..." After that, the acronym alone is fine.

- SPECIFICITY REQUIRED: Every summary must answer the basic journalistic questions the source provides — Who, What, Where, When. For any discovery, event, or development story: name the location, name the people involved, and state what was actually found or decided. A summary that omits where something happened or what was specifically discovered is not acceptable.
  WRONG: "Archaeologists have uncovered evidence of a previously unknown settlement that challenges the conventional timeline of early contact in North America."
  RIGHT: "Archaeologists excavating a site in coastal Virginia have uncovered a 15th-century settlement predating Columbus's arrival — evidence that challenges the established timeline of European contact with Native Americans by nearly a century."

- THIN STORIES: If the source material for a story is too thin to support a genuine 2-3 sentence summary — essentially just a headline reworded into one sentence — skip it entirely and use a different story from the available pool. Never pad a stub into fake substance.

- NO CLICKBAIT: Never reproduce the withholding style of source headlines. If the article names a specific vegetable, drug, food, person, place, study finding, decision, or outcome — state it directly. Never write "one vegetable," "a particular supplement," "makes a decision," "announces his future," or any phrasing that withholds the actual answer. The reader must not need to click to learn the core fact.
  WRONG: "A gastroenterologist identifies one vegetable that stands out for its ability to nourish healthy gut bacteria."
  RIGHT: "Gastroenterologists recommend leeks as a top choice for gut health, citing their high prebiotic fiber content as a key driver of beneficial gut bacteria growth."
  WRONG: "Kirk Cousins has made his retirement decision as the quarterback landscape shifts."
  RIGHT: "Kirk Cousins has announced his retirement, ending a 12-year NFL career."

- ONE STORY ONE EVENT: Each story entry must cover exactly one event, development, or topic. Never combine two unrelated stories into a single headline or summary. If two separate stories appear near each other in the source pool, write them as separate entries or pick the stronger one — never merge them. Every sentence in a summary must be about the same subject as the headline.
  WRONG: "USA advances in World Baseball Classic as tensions ease over Middle East ceasefire" — two unrelated events.
  WRONG: "Kirk Cousins has made his retirement decision as one surprise NFC contender emerges as a destination for free agents" — the NFC contender story has nothing to do with Kirk Cousins.
  RIGHT: Cover each story separately. If a sentence introduces a new subject unrelated to the headline, delete it.

- NO INVENTED FACTS: Every statistic, record, ranking, score, date, position, roster move, or comparison in your summary must come directly from the source material provided. Never supply supporting facts, figures, player positions, team affiliations, or historical comparisons from your own training data memory. If the source does not state it, you do not state it. This applies especially to sports stories — never assign a player to a team, a position, or a roster action unless the source explicitly states it.
  WRONG: "Bo Bichette has been honest about his early struggles at third base" — if the source doesn't say that, don't write it.
  WRONG: "Only Wilt Chamberlain (100 points in 1962) and Kobe Bryant (81 points in 2006) have scored more in a single game." — if this comparison is not in the source text, do not write it.
  RIGHT: Stick strictly to what the article says. If a fact is mentioned in the source, paraphrase it. If it is not in the source, leave it out entirely. When in doubt, omit.

- NO SAME-EVENT DUPLICATES: Within a single newsletter, never cover the same event, game, or development twice — even if two different articles about it appear in the source pool. Pick the one with more substance and skip the other entirely.

- WEATHER — FORWARD ONLY: The newsletter is delivered in the morning. The Local Weather panel must only cover today's current conditions and future days. Never reference yesterday or any day that has already passed. Use today's date (provided above) to determine which days are in the past and exclude them entirely.
  WRONG: Mentioning "Tuesday looks mild" in a Wednesday morning newsletter — Tuesday is already over.
  RIGHT: "Today is partly cloudy with a high of 45°F. Wednesday warms to 56°F, and Thursday clears up to sunny skies."

- NO SPORTS BLEED: Sports stories must never appear in non-Sports panels. If the subscriber selected Sports as a topic, sports stories belong exclusively in the Sports panel. If the subscriber did NOT select Sports, skip sports stories entirely — do not place them in World News, Politics, Finance, or any other panel. A subscriber who did not choose Sports does not want sports content. A game result, trade, league story, or athlete profile is a sports story regardless of which RSS feed it came from.
  WRONG: Placing "Italy Stuns United States 8-6 in World Baseball Classic" in the World News panel — whether or not the subscriber has a Sports panel.
  RIGHT: If the subscriber has a Sports panel, that story goes there. If they have no Sports panel, skip it entirely.

- NO REPEATS: If a candidate story covers the same ongoing event, court case, or policy dispute as any story in the "Already sent" list above, skip it entirely and use a different story from the available pool instead.
  WRONG: Sending a second tariff court ruling story the day after already covering a tariff Supreme Court challenge.
  RIGHT: Choosing a different story from the pool that covers a fresh, unrelated event.

- TOPIC RELEVANCE: A story must be substantively about the topic it appears under — not just mention it in passing or use it as a theme, aesthetic, or decoration. If the topic term appears only as an adjective describing something else, the story does not belong in that panel. Skip it entirely rather than force it in.
  WRONG: Including a celebrity wedding story in a "Medieval" history panel because the venue was "medieval-themed."
  RIGHT: Only include a story under "Medieval" if medieval history, the medieval period, a medieval discovery, or medieval scholarship is the primary subject of the article.

═══ TONE RULES ═══
- Warm, direct, and conversational — like a well-informed friend briefing you over coffee
- Written for an older audience — no internet slang, no pop culture references from the last 10 years
- Short sentences. Active voice. No filler.
- Never use the word "delve"
- Never use the phrases "it's worth noting," "importantly," or "it goes without saying"
- Plain text only — no markdown asterisks, no bullet points

═══ QUOTE RULES ═══
- Quote style: ${quoteStyle} — strict requirement. The quote MUST match this style regardless of the newsletter topics.
- Must be a real, well-known quote from a real, named person. No made-up attributions, no publication names.
- If the style is "Humor & Wit": use a genuinely funny quote — witty one-liners, dry humor, or absurdist observations. Mix it up.${recentQuotes.length > 0 ? `\n- DO NOT reuse any of the following quotes or their authors — both the person and the quote text are banned for today:\n${recentQuotes.map(q => `  • "${q.text}" — ${q.attribution}`).join('\n')}` : ''}`
}

// ----------------------------------------------------------------
// Parse Claude's structured response into sections
// ----------------------------------------------------------------
// Hard sentence cap — enforced in code regardless of what Claude wrote
// ----------------------------------------------------------------
function truncateToSentences(text, max = 3) {
  if (!text) return text
  const sentences = text.match(/[^.!?]*[.!?]+[\s]*/g)
  if (!sentences) return text
  return sentences.slice(0, max).join('').trim()
}

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
        stories.push({ headline: storyMatch[1].trim(), body: truncateToSentences(body), link })
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
  'Science': '🔬', 'Health': '🫀', 'Arts & Culture': '🎨', 'Food & Travel': '🍽️',
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
                <p style="margin:0;font-family:${mono};font-size:10px;letter-spacing:3px;color:#00d4ff;text-transform:uppercase;">${esc(name)}</p>
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
              <p style="margin:0;font-family:${sans};font-size:14px;line-height:1.75;color:#a8b8cc;font-weight:300;"><font color="#00d4ff"><span style="color:#00d4ff;">${esc(greetingBlue)}</span></font>${esc(greetingRest)}</p>
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
async function generateNewsletter(subscriber, topicStories, recentTitles = [], recentQuotes = []) {
  if (!topicStories || topicStories.length === 0) {
    throw new Error(`No stories available for subscriber ${subscriber.id} — cannot generate newsletter`)
  }

  const quoteStyle = resolveQuoteStyle(subscriber.quote_style)
  const allocation = calculateStoryAllocation(subscriber, topicStories)
  const cappedTopicStories = topicStories.slice(0, Object.keys(allocation).length)
  const prompt = buildPrompt(subscriber, cappedTopicStories, quoteStyle, allocation, recentTitles, recentQuotes)

  const rawText = await fetchWithRetry(async () => {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
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
  // Restore the shuffled input order — Claude may reorder topics in its output
  const inputOrder = topicStories.map(t => t.topic.toLowerCase())
  parsed.topics = Object.values(mergedTopicMap).sort((a, b) => {
    const ai = inputOrder.indexOf(a.name.toLowerCase())
    const bi = inputOrder.indexOf(b.name.toLowerCase())
    const aPos = ai === -1 ? 999 : ai
    const bPos = bi === -1 ? 999 : bi
    return aPos - bPos
  })

  // Hard-cap every topic to its allocated story count regardless of what Claude wrote.
  // Use case-insensitive lookup so minor name variations (e.g. "Health" vs "Health & Wellness")
  // don't silently fall through to the || 1 floor.
  const allocationLower = Object.fromEntries(
    Object.entries(allocation).map(([k, v]) => [k.toLowerCase(), v])
  )
  parsed.topics = parsed.topics.map(t => ({ ...t, stories: t.stories.slice(0, allocationLower[t.name.toLowerCase()] || 1) }))

  // Recover original RSS links by matching Claude's written headlines back to source articles.
  // Claude frequently mangles URLs when copying — source links are always valid.
  // Each parsed story is matched to the source article with the highest headline word overlap.
  const sourceByTopicLower = {}
  for (const { topic, stories: srcStories } of topicStories) {
    sourceByTopicLower[topic.toLowerCase()] = srcStories
  }
  const wordOverlap = (a, b) => {
    const words = s => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 3))
    const wa = words(a), wb = words(b)
    let n = 0; for (const w of wa) if (wb.has(w)) n++; return n
  }
  for (const parsedTopic of parsed.topics) {
    const sources = sourceByTopicLower[parsedTopic.name.toLowerCase()] || []
    const usedIdx = new Set()
    for (const story of parsedTopic.stories) {
      let bestIdx = -1, bestScore = -1
      for (let i = 0; i < sources.length; i++) {
        if (usedIdx.has(i)) continue
        const score = wordOverlap(story.headline, sources[i].title || '')
        if (score > bestScore) { bestScore = score; bestIdx = i }
      }
      if (bestIdx >= 0 && sources[bestIdx].link) {
        story.link = sources[bestIdx].link
        usedIdx.add(bestIdx)
      }
    }
  }

  // Drop stories with no link (every rendered story must have a working Go Deeper)
  // and drop any topic panel that ends up empty as a result
  parsed.topics = parsed.topics
    .map(t => ({ ...t, stories: t.stories.filter(s => s.link) }))
    .filter(t => t.stories.length > 0)

  // Fallback quote — used if Claude ran out of tokens before writing [QUOTE]
  if (!parsed.quote) {
    const fallbacks = {
      'Inspirational': { text: 'The secret of getting ahead is getting started.', attribution: 'Mark Twain' },
      'Philosophical': { text: 'The unexamined life is not worth living.', attribution: 'Socrates' },
      'Stoic': { text: 'You have power over your mind, not outside events. Realize this, and you will find strength.', attribution: 'Marcus Aurelius' },
      'Humor & Wit': { text: 'I am so clever that sometimes I don\'t understand a single word of what I am saying.', attribution: 'Oscar Wilde' },
      'Historical': { text: 'In the middle of difficulty lies opportunity.', attribution: 'Albert Einstein' },
      'Literary': { text: 'Not all those who wander are lost.', attribution: 'J.R.R. Tolkien' },
      'Science & Discovery': { text: 'The important thing is not to stop questioning. Curiosity has its own reason for existing.', attribution: 'Albert Einstein' },
    }
    parsed.quote = fallbacks[quoteStyle] || { text: 'The secret of getting ahead is getting started.', attribution: 'Mark Twain' }
    logger.warn(`Quote missing from Claude output for ${subscriber.email} — using fallback`)
  }

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

  // Collect all sent stories (link + headline) for deduplication and repeat-saga tracking
  const sentStories = parsed.topics
    .flatMap(t => t.stories.map(s => ({ link: s.link, title: s.headline })))
    .filter(s => s.link)

  const quoteAttribution = parsed.quote?.attribution || null
  const quoteText = parsed.quote?.text || null

  return { subject, body_html, sentStories, quoteAttribution, quoteText }
}

// ----------------------------------------------------------------
// Exports
// ----------------------------------------------------------------
module.exports = { generateNewsletter, buildMissionControlEmail, parseNewsletterContent }
