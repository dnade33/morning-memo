// Send a newsletter to a single subscriber immediately.
// Usage:
//   node scripts/send-subscriber.js adam@example.com
//   DRY_RUN=true node scripts/send-subscriber.js adam@example.com
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })

const { createClient } = require('@supabase/supabase-js')
const { logger } = require('../logger')
const { getCachedStories } = require('./fetch-rss')
const { generateNewsletter } = require('./generate-newsletter')
const { sendAndLog } = require('./send-email')

const DRY_RUN = process.env.DRY_RUN === 'true'

const email = process.argv[2]
if (!email) {
  console.error('Usage: node scripts/send-subscriber.js <email>')
  process.exit(1)
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

async function run() {
  // 1. Look up subscriber
  const { data: subscribers, error } = await supabase
    .from('subscribers')
    .select('*')
    .eq('email', email)
    .eq('active', true)
    .limit(1)

  if (error) {
    logger.error('Supabase lookup failed', error)
    process.exit(1)
  }
  if (!subscribers || subscribers.length === 0) {
    console.error(`No active subscriber found with email: ${email}`)
    process.exit(1)
  }

  const subscriber = subscribers[0]
  logger.cron(`Sending to ${subscriber.email} (${subscriber.first_name})${DRY_RUN ? ' [DRY RUN]' : ''}`)

  // 2. Fetch subtopics covered in the last 36 hours (for rotation)
  const { data: recentSubtopicRows } = await supabase
    .from('sent_subtopics')
    .select('topic, subtopic')
    .eq('subscriber_id', subscriber.id)
    .gte('sent_at', new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString())
  const recentlyCoveredSubs = new Set(
    (recentSubtopicRows || []).map(r => `${r.topic}:::${r.subtopic}`)
  )

  const MAX_SUBTOPICS = 3
  function pickSubtopics(topic, allSubs) {
    const uncovered = allSubs.filter(s => !recentlyCoveredSubs.has(`${topic}:::${s}`))
    const covered   = allSubs.filter(s =>  recentlyCoveredSubs.has(`${topic}:::${s}`))
    return [...uncovered, ...covered].slice(0, MAX_SUBTOPICS)
  }

  const selectedSubtopicsForLogging = []
  const topicOriginMap = {}

  // 3. Expand topics (same logic as cron.js)
  const expandedTopics = subscriber.topics.flatMap(topic => {
    if (topic === 'Sports') {
      const leagues = subscriber.preferences?.['Sports']
      if (!leagues || leagues.length === 0) { topicOriginMap['Sports'] = 'Sports'; return ['Sports'] }
      const selectedLeagues = pickSubtopics('Sports', leagues)
      selectedLeagues.forEach(l => selectedSubtopicsForLogging.push({ topic: 'Sports', subtopic: l }))
      return selectedLeagues.flatMap(league => {
        const safeId = league.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
        const teams = subscriber.preferences?.[`sub-sports-leagues-${safeId}`]
        if (teams && teams.length > 0) return teams.map(t => { topicOriginMap[`${league}::${t}`] = 'Sports'; return `${league}::${t}` })
        topicOriginMap[league] = 'Sports'; return [league]
      })
    }
    if (topic === 'Finance') {
      const areas = subscriber.preferences?.['Finance']
      if (!areas || areas.length === 0) { topicOriginMap['Finance'] = 'Finance'; return ['Finance'] }
      const selectedAreas = pickSubtopics('Finance', areas)
      selectedAreas.forEach(a => selectedSubtopicsForLogging.push({ topic: 'Finance', subtopic: a }))
      return selectedAreas.flatMap(area => {
        const safeId = area.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
        const picks = subscriber.preferences?.[`sub-finance-areas-${safeId}`]
        if (picks && picks.length > 0) return picks.map(p => { topicOriginMap[`Finance::${p}`] = 'Finance'; return `Finance::${p}` })
        topicOriginMap[`Finance::${area}`] = 'Finance'; return [`Finance::${area}`]
      })
    }
    if (topic === 'Technology') {
      const areas = subscriber.preferences?.['Technology']
      if (!areas || areas.length === 0) { topicOriginMap['Technology'] = 'Technology'; return ['Technology'] }
      const selectedAreas = pickSubtopics('Technology', areas)
      selectedAreas.forEach(a => selectedSubtopicsForLogging.push({ topic: 'Technology', subtopic: a }))
      return selectedAreas.flatMap(area => {
        const safeId = area.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
        const companies = subscriber.preferences?.[`sub-tech-areas-${safeId}`]
        if (companies && companies.length > 0) return companies.map(c => { topicOriginMap[`Technology::${c}`] = 'Technology'; return `Technology::${c}` })
        topicOriginMap[`Technology::${area}`] = 'Technology'; return [`Technology::${area}`]
      })
    }
    const subtopics = subscriber.preferences?.[topic]
    if (subtopics && subtopics.length > 0) {
      const selected = pickSubtopics(topic, subtopics)
      selected.forEach(s => selectedSubtopicsForLogging.push({ topic, subtopic: s }))
      return selected.map(s => { topicOriginMap[`${topic}::${s}`] = topic; return `${topic}::${s}` })
    }
    topicOriginMap[topic] = topic
    return [topic]
  })

  // 4. Fetch stories
  const rawTopicStories = await getCachedStories(expandedTopics, subscriber.city)

  // 5. Dedup against last 2 days
  const { data: recentRows } = await supabase
    .from('sent_stories')
    .select('story_link, title')
    .eq('subscriber_id', subscriber.id)
    .gte('sent_at', new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString())
  const seenLinks    = new Set((recentRows || []).map(r => r.story_link))
  const recentTitles = (recentRows || []).map(r => r.title).filter(Boolean)

  // 6. Merge by top-level topic
  const mergedGroups = {}
  for (const { topic, stories } of rawTopicStories) {
    const orig = topicOriginMap[topic] || topic
    if (!mergedGroups[orig]) mergedGroups[orig] = []
    mergedGroups[orig].push(...stories)
  }
  const topicStories = []
  for (const [topic, stories] of Object.entries(mergedGroups)) {
    const fresh = stories.filter(s => !s.link || !seenLinks.has(s.link))
    if (fresh.length > 0) topicStories.push({ topic, stories: fresh })
    else logger.cron(`No new stories for "${topic}" — skipping panel`)
  }

  if (topicStories.length === 0) {
    console.error('All topics stale — nothing to send.')
    process.exit(0)
  }

  // 7. Generate + send
  const { subject, body_html, sentStories } = await generateNewsletter(subscriber, topicStories, recentTitles)
  const result = await sendAndLog(subscriber, subject, body_html, supabase, DRY_RUN)

  if (result.success && !DRY_RUN) {
    if (sentStories.length > 0) {
      await supabase.from('sent_stories').insert(
        sentStories.map(({ link, title }) => ({ subscriber_id: subscriber.id, story_link: link, title }))
      )
    }
    if (selectedSubtopicsForLogging.length > 0) {
      await supabase.from('sent_subtopics').insert(
        selectedSubtopicsForLogging.map(({ topic, subtopic }) => ({ subscriber_id: subscriber.id, topic, subtopic }))
      )
    }
  }

  logger.cron(result.success ? `Sent to ${email}` : `Failed to send to ${email}`)
  process.exit(result.success ? 0 : 1)
}

run().catch(err => {
  logger.error('send-subscriber failed', err)
  process.exit(1)
})
