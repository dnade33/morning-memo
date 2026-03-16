// Morning Memo — Daily newsletter cron orchestrator
// A single cron fires every 30 minutes (UTC). For each subscriber,
// we check what time it is in THEIR timezone — if it matches their
// chosen delivery_time slot, they get their newsletter.
// Usage:
//   node cron.js              → runs on schedule (production)
//   DRY_RUN=true node cron.js → generates newsletters, logs only (no emails sent)
//   RUN_NOW=true node cron.js → runs all slots immediately (manual testing)
require('dotenv').config()

const cron = require('node-cron')
const { createClient } = require('@supabase/supabase-js')
const { logger } = require('./logger')
const { getCachedStories, clearFeedCache } = require('./scripts/fetch-rss')
const { generateNewsletter } = require('./scripts/generate-newsletter')
const { sendAndLog } = require('./scripts/send-email')

const DRY_RUN = process.env.DRY_RUN === 'true'

// ----------------------------------------------------------------
// Supabase client (shared across all slots in a run)
// ----------------------------------------------------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// ----------------------------------------------------------------
// Sports story detector — used to strip sports content from
// non-sports panels before stories ever reach Claude
// ----------------------------------------------------------------
const SPORTS_TOPIC_KEYS = new Set([
  'Sports', 'NFL', 'NBA', 'MLB', 'NHL',
  'College Football', 'College Basketball', 'Soccer / MLS', 'Golf'
])

const SPORTS_KEYWORDS = [
  // Leagues & tournaments
  /\bNFL\b/, /\bNBA\b/, /\bMLB\b/, /\bNHL\b/, /\bMLS\b/, /\bUFC\b/, /\bPGA\b/,
  /\bWBC\b/, /world baseball classic/i, /world cup/i, /super bowl/i,
  /world series/i, /stanley cup/i, /march madness/i, /ncaa tournament/i,
  /champions league/i, /premier league/i,
  // Game/sport terms
  /\bplayoff[s]?\b/i, /\bpostseason\b/i, /\bdraft pick\b/i, /\btrade deadline\b/i,
  /\bfree agent\b/i, /\broster move\b/i, /\bspring training\b/i,
  /\bhome run\b/i, /\btouchdown\b/i, /\bthree.pointer\b/i, /\bhat trick\b/i,
  /\bno.hitter\b/i, /\bshutout\b/i, /\bovertim[e]\b/i,
  /\bquarterback\b/i, /\bpitcher\b/i, /\bgoalkeeper\b/i,
  /\badvances to (the )?semifinal/i, /\badvances to (the )?final/i,
  /\bdefeated .+ \d+.?\d+\b/i,
]

function isSportsStory(title = '', summary = '') {
  const text = `${title} ${summary}`
  return SPORTS_KEYWORDS.some(re => re.test(text))
}

// ----------------------------------------------------------------
// Delivery time slots (matches what the form offers subscribers)
// ----------------------------------------------------------------
const TIME_SLOTS = [
  '6:00am', '6:30am',
  '7:00am', '7:30am',
  '8:00am', '8:30am',
  '9:00am', '9:30am',
  '10:00am'
]

// ----------------------------------------------------------------
// Returns the current time slot string (e.g. "7:00am") for a given
// IANA timezone. Returns null if the current minute doesn't land on
// one of our defined slots.
// ----------------------------------------------------------------
function getCurrentSlot(timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).formatToParts(new Date())
    const hour   = parts.find(p => p.type === 'hour').value
    const minute = parts.find(p => p.type === 'minute').value
    const period = parts.find(p => p.type === 'dayPeriod').value.toLowerCase()
    return `${hour}:${minute}${period}` // e.g. "7:00am"
  } catch {
    return null
  }
}

// ----------------------------------------------------------------
// Process one delivery time slot — subscribers must be pre-fetched
// ----------------------------------------------------------------
async function processSlot(slot, subscribers) {
  logger.cron(`Starting slot: ${slot}`)

  if (!subscribers || subscribers.length === 0) {
    logger.cron(`No subscribers for slot ${slot} — skipping`)
    return { sent: 0, failed: 0 }
  }

  logger.cron(`Processing ${subscribers.length} subscriber(s) for slot ${slot}`)

  // 2. Pre-fetch all unique topics needed for this slot batch
  const allTopics = [...new Set(subscribers.flatMap(s => s.topics))]
  // Collect unique cities for Local Weather subscribers
  const weatherCities = [...new Set(
    subscribers
      .filter(s => s.topics.includes('Local Weather') && s.city)
      .map(s => s.city)
  )]

  // Prime the cache for non-weather topics (best-effort — failures are handled per-subscriber)
  const primeTopics = allTopics.filter(t => t !== 'Local Weather')
  if (primeTopics.length > 0) {
    logger.cron(`Pre-fetching RSS for topics: ${primeTopics.join(', ')}`)
    // getCachedStories handles individual topic failures gracefully
    await getCachedStories(primeTopics, null)
  }

  // 3. Process each subscriber (up to 5 concurrently)
  let sent = 0
  let failed = 0

  async function processSubscriber(subscriber) {
    // Guard: skip if already sent today (prevents duplicate sends on Railway deploys)
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const { data: sentToday } = await supabase
      .from('newsletters')
      .select('id')
      .eq('subscriber_id', subscriber.id)
      .eq('status', 'sent')
      .gte('sent_at', todayStart.toISOString())
      .limit(1)
    if (sentToday && sentToday.length > 0) {
      logger.cron(`Already sent today — skipping ${subscriber.email}`)
      return
    }

    // Fetch subtopics covered for this subscriber in the last 36 hours
    // so we can rotate coverage across subtopics day-to-day.
    const { data: recentSubtopicRows } = await supabase
      .from('sent_subtopics')
      .select('topic, subtopic')
      .eq('subscriber_id', subscriber.id)
      .gte('sent_at', new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString())
    const recentlyCoveredSubs = new Set(
      (recentSubtopicRows || []).map(r => `${r.topic}:::${r.subtopic}`)
    )

    // Pick up to 3 subtopics for a topic, prioritising ones not covered yesterday.
    const MAX_SUBTOPICS = 3
    function pickSubtopics(topic, allSubs) {
      const uncovered = allSubs.filter(s => !recentlyCoveredSubs.has(`${topic}:::${s}`))
      const covered = allSubs.filter(s => recentlyCoveredSubs.has(`${topic}:::${s}`))
      return [...uncovered, ...covered].slice(0, MAX_SUBTOPICS)
    }

    // Track which subtopics are selected this run so we can log them after send.
    const selectedSubtopicsForLogging = []  // { topic, subtopic }

    // Expand topics into sub-topic or specific-pick level using :: notation.
    // "Parent::Term" topics use Google News search; fallback is Parent's RSS feed.
    // topicOriginMap tracks every fetched key → subscriber's top-level topic so
    // we can merge all results back under one panel per top-level topic afterwards.
    const topicOriginMap = {}

    const expandedTopics = subscriber.topics.flatMap(topic => {

      // ── Sports: league → team (niches route as Sports::niche) ────────────
      if (topic === 'Sports') {
        const SPORT_LEAGUES = new Set(['NFL','NBA','MLB','NHL','College Football','College Basketball','Soccer / MLS','Golf','Tennis','UFC / Boxing','NASCAR'])
        // preferences['Sports'] may contain leagues AND mixed niches (from subscription form)
        // preferences['sports-niches'] contains niches saved via the preferences update form
        const sportsPrefs = subscriber.preferences?.['Sports'] || []
        const sportsNiches = subscriber.preferences?.['sports-niches'] || []

        // If the 'Sports' league list is missing, infer leagues from sub-keys
        // (handles subscribers whose preferences were saved without the parent array)
        const LEAGUE_SUB_KEY_MAP = {
          'sub-sports-leagues-nfl':                'NFL',
          'sub-sports-leagues-nba':                'NBA',
          'sub-sports-leagues-mlb':                'MLB',
          'sub-sports-leagues-nhl':                'NHL',
          'sub-sports-leagues-college-football':   'College Football',
          'sub-sports-leagues-college-basketball': 'College Basketball',
          'sub-sports-leagues-soccer---mls':       'Soccer / MLS',
          'sub-sports-leagues-golf':               'Golf',
        }
        const inferredLeagues = sportsPrefs.length === 0
          ? Object.entries(LEAGUE_SUB_KEY_MAP)
              .filter(([key]) => subscriber.preferences?.[key]?.length > 0)
              .map(([, league]) => league)
          : []

        const allSportsItems = [...new Set([...sportsPrefs, ...sportsNiches, ...inferredLeagues])]
        if (allSportsItems.length === 0) {
          topicOriginMap['Sports'] = 'Sports'
          return ['Sports']
        }
        const selected = pickSubtopics('Sports', allSportsItems)
        selected.forEach(l => selectedSubtopicsForLogging.push({ topic: 'Sports', subtopic: l }))
        return selected.flatMap(league => {
          // Niche topics (non-leagues) → Google News search via Sports::niche
          if (!SPORT_LEAGUES.has(league)) {
            topicOriginMap[`Sports::${league}`] = 'Sports'
            return [`Sports::${league}`]
          }
          const safeId = league.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
          const teams = subscriber.preferences?.[`sub-sports-leagues-${safeId}`]
          if (teams && teams.length > 0) {
            return teams.map(t => {
              topicOriginMap[`${league}::${t}`] = 'Sports'
              return `${league}::${t}`
            })
          }
          topicOriginMap[league] = 'Sports'
          return [league]
        })
      }

      // ── Finance: area → specific pick ─────────────────────────────────────
      if (topic === 'Finance') {
        const areas = subscriber.preferences?.['Finance']
        if (!areas || areas.length === 0) {
          topicOriginMap['Finance'] = 'Finance'
          return ['Finance']
        }
        const selectedAreas = pickSubtopics('Finance', areas)
        selectedAreas.forEach(a => selectedSubtopicsForLogging.push({ topic: 'Finance', subtopic: a }))
        return selectedAreas.flatMap(area => {
          const safeId = area.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
          const picks = subscriber.preferences?.[`sub-finance-areas-${safeId}`]
          if (picks && picks.length > 0) {
            return picks.map(p => {
              topicOriginMap[`Finance::${p}`] = 'Finance'
              return `Finance::${p}`
            })
          }
          topicOriginMap[`Finance::${area}`] = 'Finance'
          return [`Finance::${area}`]
        })
      }

      // ── Technology: area → specific company ───────────────────────────────
      if (topic === 'Technology') {
        const areas = subscriber.preferences?.['Technology']
        if (!areas || areas.length === 0) {
          topicOriginMap['Technology'] = 'Technology'
          return ['Technology']
        }
        const selectedAreas = pickSubtopics('Technology', areas)
        selectedAreas.forEach(a => selectedSubtopicsForLogging.push({ topic: 'Technology', subtopic: a }))
        return selectedAreas.flatMap(area => {
          const safeId = area.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
          const companies = subscriber.preferences?.[`sub-tech-areas-${safeId}`]
          if (companies && companies.length > 0) {
            return companies.map(c => {
              topicOriginMap[`Technology::${c}`] = 'Technology'
              return `Technology::${c}`
            })
          }
          topicOriginMap[`Technology::${area}`] = 'Technology'
          return [`Technology::${area}`]
        })
      }

      // ── Generic two-level expansion (Science, Health, History, etc.) ──
      // Any topic where the subscriber picked subtopics gets targeted
      // Google News searches instead of a broad RSS feed.
      const subtopics = subscriber.preferences?.[topic]
      if (subtopics && subtopics.length > 0) {
        const selected = pickSubtopics(topic, subtopics)
        selected.forEach(s => selectedSubtopicsForLogging.push({ topic, subtopic: s }))
        return selected.map(s => {
          topicOriginMap[`${topic}::${s}`] = topic
          return `${topic}::${s}`
        })
      }

      topicOriginMap[topic] = topic
      return [topic]
    })

    // Fetch stories for this subscriber's specific topics
    const rawTopicStories = await getCachedStories(expandedTopics, subscriber.city)

    // Fetch story links + titles sent to this subscriber in the last 2 days
    const { data: recentRows } = await supabase
      .from('sent_stories')
      .select('story_link, title')
      .eq('subscriber_id', subscriber.id)
      .gte('sent_at', new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString())
    const seenLinks = new Set((recentRows || []).map(r => r.story_link).filter(l => !l?.startsWith('quote::')))
    const seenTitles = new Set((recentRows || []).filter(r => r.title && !r.story_link?.startsWith('quote::')).map(r => r.title.toLowerCase().trim()))
    const recentTitles = (recentRows || []).map(r => r.title).filter(Boolean)
    const recentQuotes = (recentRows || [])
      .filter(r => r.story_link?.startsWith('quote::'))
      .map(r => ({ attribution: r.story_link.replace('quote::', ''), text: r.title || '' }))

    // Merge all fetched results into one pool per subscriber top-level topic.
    // topicOriginMap resolves any expanded key back to its origin:
    //   NFL::Cowboys → Sports,  Finance::Real Estate → Finance,  World News::US → World News
    // The email will show exactly one panel per top-level topic.
    const mergedGroups = {}  // originalTopic → stories[]
    for (const { topic, stories } of rawTopicStories) {
      const originalTopic = topicOriginMap[topic] || topic
      if (!mergedGroups[originalTopic]) mergedGroups[originalTopic] = []
      mergedGroups[originalTopic].push(...stories)
    }

    // Filter out already-seen stories, and strip sports stories from non-sports panels
    const topicStories = []
    for (const [topic, stories] of Object.entries(mergedGroups)) {
      const isSportsPanel = SPORTS_TOPIC_KEYS.has(topic)
      const freshStories = stories.filter(s => {
        if (s.link && seenLinks.has(s.link)) return false
        if (s.title && seenTitles.has(s.title.toLowerCase().trim())) return false
        // If this is a non-sports panel and the subscriber has a sports panel (or has no sports
        // panel at all), strip any story that reads as a sports story
        if (!isSportsPanel && isSportsStory(s.title, s.summary)) {
          logger.cron(`Stripped sports story from "${topic}" panel for ${subscriber.email}: ${s.title}`)
          return false
        }
        return true
      })
      if (freshStories.length > 0) {
        topicStories.push({ topic, stories: freshStories })
      } else {
        logger.cron(`No new stories for topic "${topic}" for ${subscriber.email} — skipping panel`)
      }
    }

    if (topicStories.length === 0) {
      logger.cron(`All topics stale for ${subscriber.email} — skipping today`)
      return { success: false }
    }

    // Shuffle topic order so panels appear in a different sequence each day.
    // Local Weather is always pinned to the end.
    const weatherPanel = topicStories.find(t => t.topic === 'Local Weather')
    const nonWeather = topicStories.filter(t => t.topic !== 'Local Weather')
    for (let i = nonWeather.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nonWeather[i], nonWeather[j]] = [nonWeather[j], nonWeather[i]]
    }
    const shuffledTopicStories = weatherPanel ? [...nonWeather, weatherPanel] : nonWeather

    // Generate newsletter via Claude Haiku
    const { subject, body_html, sentStories, quoteAttribution, quoteText } = await generateNewsletter(subscriber, shuffledTopicStories, recentTitles, recentQuotes)

    // Send + log
    const result = await sendAndLog(subscriber, subject, body_html, supabase, DRY_RUN)

    // Log sent story links + titles for deduplication and repeat-saga tracking (skip in dry run)
    if (result.success && !DRY_RUN) {
      const inserts = sentStories.map(({ link, title }) => ({ subscriber_id: subscriber.id, story_link: link, title }))
      if (quoteAttribution) {
        inserts.push({ subscriber_id: subscriber.id, story_link: `quote::${quoteAttribution}`, title: quoteText })
      }
      if (inserts.length > 0) {
        await supabase.from('sent_stories').insert(inserts)
      }
    }

    // Log covered subtopics for rotation (skip in dry run)
    if (result.success && !DRY_RUN && selectedSubtopicsForLogging.length > 0) {
      await supabase.from('sent_subtopics').insert(
        selectedSubtopicsForLogging.map(({ topic, subtopic }) => ({
          subscriber_id: subscriber.id, topic, subtopic
        }))
      )
    }

    return { success: result.success }
  }

  // Run up to 5 subscribers concurrently
  const CONCURRENCY = 5
  const executing = new Set()
  for (const subscriber of subscribers) {
    const p = processSubscriber(subscriber)
      .then(({ success }) => { success ? sent++ : failed++ })
      .catch(async err => {
        logger.error(`Failed to process subscriber ${subscriber.email} in slot ${slot}`, err.message)
        failed++
        if (!DRY_RUN) {
          await supabase.from('newsletters').insert({
            subscriber_id: subscriber.id,
            subject: `Newsletter generation failed — ${new Date().toLocaleDateString()}`,
            body_html: '',
            delivery_time: slot,
            status: 'failed'
          }).then(({ error: logErr }) => {
            if (logErr) logger.error('Failed to log newsletter failure row', logErr)
          })
        }
      })
      .finally(() => executing.delete(p))
    executing.add(p)
    if (executing.size >= CONCURRENCY) await Promise.race(executing)
  }
  await Promise.all([...executing])

  // 4. Clear feed cache between time slots (keep memory clean)
  clearFeedCache()

  logger.cron(`Slot ${slot} complete`, { sent, failed, total: subscribers.length })
  return { sent, failed }
}

// ----------------------------------------------------------------
// Fetch all active subscribers from Supabase
// ----------------------------------------------------------------
async function fetchAllActiveSubscribers() {
  const { data, error } = await supabase
    .from('subscribers')
    .select('*')
    .eq('active', true)
  if (error) {
    logger.error('Failed to fetch active subscribers', error)
    return []
  }
  return data || []
}

// ----------------------------------------------------------------
// Main run function — used by RUN_NOW (processes every subscriber
// regardless of current time, grouped by their delivery_time slot)
// ----------------------------------------------------------------
async function runCron() {
  const startTime = new Date()
  logger.cron(`=== Morning Memo cron started${DRY_RUN ? ' [DRY RUN]' : ''} ===`)

  const allSubs = await fetchAllActiveSubscribers()

  // Group by delivery_time slot
  const slotGroups = {}
  for (const sub of allSubs) {
    const slot = sub.delivery_time
    if (!slot) continue
    if (!slotGroups[slot]) slotGroups[slot] = []
    slotGroups[slot].push(sub)
  }

  let totalSent = 0
  let totalFailed = 0

  for (const slot of TIME_SLOTS) {
    const subs = slotGroups[slot]
    if (!subs || subs.length === 0) continue
    try {
      const { sent, failed } = await processSlot(slot, subs)
      totalSent += sent
      totalFailed += failed
    } catch (err) {
      logger.error(`Unexpected error processing slot ${slot}`, err)
    }
  }

  const durationMs = Date.now() - startTime.getTime()
  logger.cron(`=== Morning Memo cron finished ===`, {
    totalSent,
    totalFailed,
    durationMs,
    dryRun: DRY_RUN
  })
}

// ----------------------------------------------------------------
// Entry point (only runs when executed directly, not when imported)
// ----------------------------------------------------------------
if (require.main === module) {
  if (process.env.RUN_NOW === 'true') {
    // Manual trigger for testing — run all active subscribers immediately
    logger.cron('RUN_NOW=true — executing all slots immediately')
    runCron().catch(err => {
      logger.error('Cron run failed', err)
      process.exit(1)
    })
  } else {
    // Production: single cron fires every 30 min (UTC).
    // For each active subscriber, check if "now" in their timezone
    // matches their chosen delivery_time — if so, send their newsletter.
    cron.schedule('0,30 * * * *', async () => {
      const allSubs = await fetchAllActiveSubscribers()
      if (allSubs.length === 0) return

      // Group subscribers whose local time matches a valid slot right now
      const slotGroups = {}
      for (const sub of allSubs) {
        const tz   = sub.timezone || 'America/New_York'
        const slot = getCurrentSlot(tz)
        if (!slot || !TIME_SLOTS.includes(slot)) continue
        if (sub.delivery_time !== slot) continue
        if (!slotGroups[slot]) slotGroups[slot] = []
        slotGroups[slot].push(sub)
      }

      for (const [slot, subs] of Object.entries(slotGroups)) {
        processSlot(slot, subs).catch(err => {
          logger.error(`Cron slot ${slot} failed`, err)
        })
      }
    }, { timezone: 'UTC' })

    logger.cron(`Cron scheduled — fires every 30 min (UTC), timezone-aware per subscriber${DRY_RUN ? ' [DRY RUN mode]' : ''}`)
  }
}

module.exports = { runCron }
