// Morning Memo — Daily newsletter cron orchestrator
// Runs at 2:00am EST. Processes each delivery time slot in order.
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
// Delivery time slots (matches what the form offers subscribers)
// ----------------------------------------------------------------
const TIME_SLOTS = [
  '6:00am', '6:30am',
  '7:00am', '7:30am',
  '8:00am', '8:30am',
  '9:00am'
]

// ----------------------------------------------------------------
// Process one delivery time slot
// ----------------------------------------------------------------
async function processSlot(slot) {
  logger.cron(`Starting slot: ${slot}`)

  // 1. Fetch active subscribers for this slot
  const { data: subscribers, error } = await supabase
    .from('subscribers')
    .select('*')
    .eq('active', true)
    .eq('delivery_time', slot)

  if (error) {
    logger.error(`Failed to fetch subscribers for slot ${slot}`, error)
    return { sent: 0, failed: 0 }
  }

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

  // 3. Process each subscriber
  let sent = 0
  let failed = 0

  for (const subscriber of subscribers) {
    try {
      // Expand "Sports" into specific league topics from preferences, or fall back to generic Sports feed
      const expandedTopics = subscriber.topics.flatMap(topic => {
        if (topic === 'Sports') {
          const leagues = subscriber.preferences?.['Sports']
          return (leagues && leagues.length > 0) ? leagues : ['Sports']
        }
        return [topic]
      })

      // Fetch stories for this subscriber's specific topics
      const rawTopicStories = await getCachedStories(expandedTopics, subscriber.city)

      // Fetch story links sent to this subscriber in the last 7 days
      const { data: recentRows } = await supabase
        .from('sent_stories')
        .select('story_link')
        .eq('subscriber_id', subscriber.id)
        .gte('sent_at', new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString())
      const seenLinks = new Set((recentRows || []).map(r => r.story_link))

      // Filter out already-seen stories; drop topics that have nothing new
      const topicStories = rawTopicStories
        .map(({ topic, stories }) => ({
          topic,
          stories: stories.filter(s => !s.link || !seenLinks.has(s.link))
        }))
        .filter(({ topic, stories }) => {
          if (stories.length === 0) {
            logger.cron(`No new stories for topic "${topic}" for ${subscriber.email} — skipping panel`)
            return false
          }
          return true
        })

      if (topicStories.length === 0) {
        logger.cron(`All topics stale for ${subscriber.email} — skipping today`)
        continue
      }

      // Generate newsletter via Claude Haiku
      const { subject, body_html, sentLinks } = await generateNewsletter(subscriber, topicStories)

      // Send + log
      const result = await sendAndLog(subscriber, subject, body_html, supabase, DRY_RUN)
      result.success ? sent++ : failed++

      // Log sent story links for future deduplication (skip in dry run)
      if (result.success && !DRY_RUN && sentLinks.length > 0) {
        await supabase.from('sent_stories').insert(
          sentLinks.map(link => ({ subscriber_id: subscriber.id, story_link: link }))
        )
      }

    } catch (err) {
      logger.error(`Failed to process subscriber ${subscriber.email} in slot ${slot}`, err.message)
      failed++

      // Log a 'failed' newsletter row so the run is auditable
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
    }

    // Rate limit: 200ms between subscribers (Anthropic + Resend)
    await new Promise(r => setTimeout(r, 200))
  }

  // 4. Clear feed cache between time slots (keep memory clean)
  clearFeedCache()

  logger.cron(`Slot ${slot} complete`, { sent, failed, total: subscribers.length })
  return { sent, failed }
}

// ----------------------------------------------------------------
// Main run function — processes all time slots sequentially
// ----------------------------------------------------------------
async function runCron() {
  const startTime = new Date()
  logger.cron(`=== Morning Memo cron started${DRY_RUN ? ' [DRY RUN]' : ''} ===`)

  let totalSent = 0
  let totalFailed = 0

  for (const slot of TIME_SLOTS) {
    try {
      const { sent, failed } = await processSlot(slot)
      totalSent += sent
      totalFailed += failed
    } catch (err) {
      // Catch unexpected errors so one slot failure doesn't abort the rest
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
    // Manual trigger for testing — run immediately without waiting for schedule
    logger.cron('RUN_NOW=true — executing immediately')
    runCron().catch(err => {
      logger.error('Cron run failed', err)
      process.exit(1)
    })
  } else {
    // Production schedule: 2:00am every day, Eastern Time
    cron.schedule('0 2 * * *', () => {
      runCron().catch(err => {
        logger.error('Cron run failed', err)
      })
    }, {
      timezone: 'America/New_York'
    })

    logger.cron(`Cron scheduled — runs at 2:00am ET daily${DRY_RUN ? ' [DRY RUN mode]' : ''}`)
  }
}

module.exports = { runCron }
