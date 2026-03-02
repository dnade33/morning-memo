// Morning Memo — Express API server
// Handles subscriber onboarding (POST /api/subscribe)
require('dotenv').config()

const express = require('express')
const cors = require('cors')
const { createClient } = require('@supabase/supabase-js')
const { logger } = require('./logger')
const { sendWelcomeEmail } = require('./scripts/send-email')

const path = require('path')

const app = express()
app.use(cors())
app.use(express.json())

// Serve preferences.html at /preferences.html
app.use(express.static(path.join(__dirname)))

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
