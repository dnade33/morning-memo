// Morning Memo — Express API server
// Handles subscriber onboarding (POST /api/subscribe)
require('dotenv').config()

const express = require('express')
const cors = require('cors')
const { createClient } = require('@supabase/supabase-js')
const { logger } = require('./logger')
const { sendWelcomeEmail } = require('./scripts/send-email')
const { runCron } = require('./cron')

const path = require('path')

const app = express()
app.use(cors())
app.use(express.json())

// Serve static files; use morning-memo-combined.html as the default root page
app.use(express.static(path.join(__dirname), { index: 'morning-memo-combined.html' }))

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// ----------------------------------------------------------------
// Validation helpers
// ----------------------------------------------------------------
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// ----------------------------------------------------------------
// POST /api/subscribe
// ----------------------------------------------------------------
app.post('/api/subscribe', async (req, res) => {
  const { name, email, topics, city, tagAnswers, time, quoteStyle, extra } = req.body

  // --- Validate required fields ---
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'name is required' })
  }
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'valid email is required' })
  }
  if (!Array.isArray(topics) || topics.length === 0) {
    return res.status(400).json({ error: 'at least one topic is required' })
  }
  if (topics.includes('Local Weather') && (!city || city.trim() === '')) {
    return res.status(400).json({ error: 'city is required when Local Weather is selected' })
  }
  if (!time || typeof time !== 'string') {
    return res.status(400).json({ error: 'delivery time is required' })
  }
  if (!quoteStyle || typeof quoteStyle !== 'string') {
    return res.status(400).json({ error: 'quote style is required' })
  }

  // --- Sanitize ---
  const cleanEmail = email.toLowerCase().trim()
  const cleanName = name.trim()
  const cleanCity = city ? city.trim() : null
  const preferences = (tagAnswers && typeof tagAnswers === 'object') ? tagAnswers : {}

  // --- Upsert to Supabase (re-subscribers update their prefs) ---
  const { data, error } = await supabase
    .from('subscribers')
    .upsert(
      {
        first_name: cleanName,
        email: cleanEmail,
        topics,
        city: cleanCity,
        preferences,
        delivery_time: time,
        quote_style: quoteStyle,
        extra_notes: extra || null,
        active: true
      },
      { onConflict: 'email' }
    )
    .select('id, pref_token')
    .single()

  if (error) {
    logger.error('Failed to upsert subscriber', error)
    return res.status(500).json({ error: 'Failed to save subscription' })
  }

  logger.info(`Subscriber saved: ${cleanEmail}`, { id: data.id })

  // Fire welcome email — non-blocking, won't delay the response
  sendWelcomeEmail({
    first_name: cleanName,
    email: cleanEmail,
    topics,
    delivery_time: time,
    pref_token: data.pref_token
  })

  return res.status(200).json({ id: data.id })
})

// ----------------------------------------------------------------
// GET /api/preferences?token=xxx
// Returns subscriber's current preferences (for pre-filling the form)
// ----------------------------------------------------------------
app.get('/api/preferences', async (req, res) => {
  const { token } = req.query

  if (!token) {
    return res.status(400).json({ error: 'token is required' })
  }

  const { data, error } = await supabase
    .from('subscribers')
    .select('first_name, email, topics, city, preferences, delivery_time, quote_style, extra_notes')
    .eq('pref_token', token)
    .single()

  if (error || !data) {
    return res.status(404).json({ error: 'Subscriber not found' })
  }

  return res.status(200).json(data)
})

// ----------------------------------------------------------------
// POST /api/preferences
// Updates subscriber preferences by token
// ----------------------------------------------------------------
app.post('/api/preferences', async (req, res) => {
  const { token, topics, city, tagAnswers, time, quoteStyle, extra } = req.body

  if (!token) {
    return res.status(400).json({ error: 'token is required' })
  }
  if (!Array.isArray(topics) || topics.length === 0) {
    return res.status(400).json({ error: 'at least one topic is required' })
  }
  if (topics.includes('Local Weather') && (!city || city.trim() === '')) {
    return res.status(400).json({ error: 'city is required when Local Weather is selected' })
  }
  if (!time || typeof time !== 'string') {
    return res.status(400).json({ error: 'delivery time is required' })
  }
  if (!quoteStyle || typeof quoteStyle !== 'string') {
    return res.status(400).json({ error: 'quote style is required' })
  }

  const preferences = (tagAnswers && typeof tagAnswers === 'object') ? tagAnswers : {}

  const { error } = await supabase
    .from('subscribers')
    .update({
      topics,
      city: city ? city.trim() : null,
      preferences,
      delivery_time: time,
      quote_style: quoteStyle,
      extra_notes: extra || null
    })
    .eq('pref_token', token)

  if (error) {
    logger.error('Failed to update preferences', error)
    return res.status(500).json({ error: 'Failed to update preferences' })
  }

  logger.info(`Preferences updated via token ${token.slice(0, 8)}...`)
  return res.status(200).json({ success: true })
})

// ----------------------------------------------------------------
// GET /api/unsubscribe?token=xxx
// One-click unsubscribe — sets active=false and redirects to confirmation page
// ----------------------------------------------------------------
app.post('/api/unsubscribe', async (req, res) => {
  const { token } = req.body

  if (!token) return res.status(400).json({ error: 'token is required' })

  const { error } = await supabase
    .from('subscribers')
    .update({ active: false })
    .eq('pref_token', token)

  if (error) {
    logger.error('Failed to unsubscribe', error)
    return res.status(500).json({ error: 'Failed to unsubscribe' })
  }

  logger.info(`Subscriber unsubscribed via token ${token.slice(0, 8)}...`)
  res.status(200).json({ success: true })
})

// ----------------------------------------------------------------
// POST /api/run-cron
// Triggered by external cron service (cron-job.org) — protected by secret
// ----------------------------------------------------------------
app.post('/api/run-cron', (req, res) => {
  const auth = req.headers['authorization']
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  // Fire and forget — cron can take several minutes, don't block the response
  runCron().catch(err => logger.error('Cron run failed via HTTP trigger', err))
  res.json({ started: true })
})

// ----------------------------------------------------------------
// Admin auth middleware
// ----------------------------------------------------------------
function requireAdmin(req, res, next) {
  const auth = req.headers['authorization']
  if (!process.env.ADMIN_PASSWORD || auth !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// ----------------------------------------------------------------
// GET /api/admin/metrics
// ----------------------------------------------------------------
app.get('/api/admin/metrics', requireAdmin, async (req, res) => {
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const [
    { data: subscribers },
    { data: recentNewsletters }
  ] = await Promise.all([
    supabase
      .from('subscribers')
      .select('id, first_name, email, topics, delivery_time, active, created_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('newsletters')
      .select('id, subject, status, sent_at, subscriber_id')
      .gte('sent_at', weekAgo.toISOString())
      .order('sent_at', { ascending: false })
      .limit(100)
  ])

  // Join newsletters with subscriber info
  const subMap = Object.fromEntries((subscribers || []).map(s => [s.id, s]))
  const enriched = (recentNewsletters || []).map(n => ({
    ...n,
    subscriber_name: subMap[n.subscriber_id]?.first_name,
    subscriber_email: subMap[n.subscriber_id]?.email
  }))

  // Compute topic + time breakdowns (active subscribers only)
  const topicCounts = {}
  const timeCounts = {}
  for (const sub of (subscribers || [])) {
    if (!sub.active) continue
    for (const t of (sub.topics || [])) topicCounts[t] = (topicCounts[t] || 0) + 1
    if (sub.delivery_time) timeCounts[sub.delivery_time] = (timeCounts[sub.delivery_time] || 0) + 1
  }

  const activeCount = (subscribers || []).filter(s => s.active).length
  const todaySent = enriched.filter(n => n.status === 'sent' && new Date(n.sent_at) >= todayStart).length
  const todayFailed = enriched.filter(n => n.status === 'failed' && new Date(n.sent_at) >= todayStart).length

  res.json({
    generated_at: now.toISOString(),
    subscribers: {
      total: (subscribers || []).length,
      active: activeCount,
      inactive: (subscribers || []).length - activeCount,
      by_delivery_time: timeCounts,
      by_topic: topicCounts,
      list: subscribers || []
    },
    newsletters: {
      today: { sent: todaySent, failed: todayFailed },
      recent: enriched
    }
  })
})

// ----------------------------------------------------------------
// GET /health
// ----------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// ----------------------------------------------------------------
// Start
// ----------------------------------------------------------------
const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  logger.info(`Morning Memo server running on port ${PORT}`)
})
