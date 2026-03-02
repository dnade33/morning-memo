// Morning Memo — Email sending via Resend + Supabase logging
const { Resend } = require('resend')
const { logger } = require('../logger')

const resend = new Resend(process.env.RESEND_API_KEY)

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
// Build the welcome email HTML
//
// subscriber: { first_name, email, topics, delivery_time, pref_token }
// ----------------------------------------------------------------
function buildWelcomeEmail(subscriber) {
  const mono = `'JetBrains Mono','IBM Plex Mono','Courier New',monospace`
  const sans = `'Space Grotesk','Segoe UI',Arial,sans-serif`

  const topicBadges = (subscriber.topics || []).map(t =>
    `<span style="display:inline-block;margin:4px 4px 0 0;padding:4px 10px;font-family:${mono};font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#00d4ff;border:1px solid rgba(0,212,255,0.3);background:rgba(0,212,255,0.05);">${esc(t)}</span>`
  ).join('')

  const prefToken = subscriber.pref_token || ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Morning Memo</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@300;400;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#0d1524;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1524;padding:32px 12px;">
    <tr>
      <td align="center">
        <table width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;background:#111827;border:1px solid rgba(255,255,255,0.07);">

          <!-- ── MASTHEAD ── -->
          <tr>
            <td align="center" style="padding:28px 20px 22px;border-bottom:1px solid rgba(255,255,255,0.08);">
              <p style="margin:0;font-family:${mono};font-size:22px;font-weight:700;color:#dde2ed;letter-spacing:0.05em;">Morning<span style="color:#00d4ff;">Memo</span></p>
              <p style="margin:8px 0 0;font-family:${mono};font-size:10px;letter-spacing:3px;color:#00d4ff;text-transform:uppercase;">Welcome Aboard</p>
            </td>
          </tr>

          <!-- ── GREETING ── -->
          <tr>
            <td style="padding:24px 20px 16px;">
              <p style="margin:0 0 4px;font-family:${mono};font-size:10px;letter-spacing:3px;color:#00d4ff;text-transform:uppercase;">Good to have you, ${esc(subscriber.first_name)}</p>
              <p style="margin:10px 0 0;font-family:${sans};font-size:14px;line-height:1.75;color:#a8b8cc;font-weight:300;">Your Morning Memo subscription is confirmed. Every morning you'll receive a sharp, personalized briefing — written just for you.</p>
            </td>
          </tr>

          <!-- ── DIVIDER ── -->
          <tr>
            <td style="padding:0 20px 6px;">
              <div style="height:1px;background:rgba(255,255,255,0.06);"></div>
            </td>
          </tr>

          <!-- ── YOUR TOPICS ── -->
          <tr>
            <td style="padding:6px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid rgba(255,255,255,0.07);">
                <tr>
                  <td style="background:rgba(0,212,255,0.05);border-bottom:1px solid rgba(0,212,255,0.15);padding:8px 18px;">
                    <p style="margin:0;font-family:${mono};font-size:10px;letter-spacing:3px;color:#00d4ff;text-transform:uppercase;">Your Briefing Topics</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 18px;">
                    ${topicBadges}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── FIRST DELIVERY ── -->
          <tr>
            <td style="padding:6px 20px 16px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid rgba(255,255,255,0.07);">
                <tr>
                  <td style="background:rgba(0,212,255,0.05);border-bottom:1px solid rgba(0,212,255,0.15);padding:8px 18px;">
                    <p style="margin:0;font-family:${mono};font-size:10px;letter-spacing:3px;color:#00d4ff;text-transform:uppercase;">First Delivery</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 18px;">
                    <p style="margin:0;font-family:${sans};font-size:14px;line-height:1.75;color:#a8b8cc;font-weight:300;">Your first Morning Memo will arrive tomorrow at <span style="font-family:${mono};color:#dde2ed;font-weight:700;">${esc(subscriber.delivery_time)}</span>.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── FOOTER ── -->
          <tr>
            <td style="border-top:1px solid rgba(255,255,255,0.06);padding:20px;text-align:center;">
              <p style="margin:0 0 8px;font-family:${mono};font-size:11px;font-weight:700;color:#dde2ed;letter-spacing:0.05em;">Morning<span style="color:#00d4ff;">Memo</span></p>
              <p style="margin:0 0 12px;font-family:${sans};font-size:12px;color:#6b7fa0;line-height:1.6;">
                You signed up at morningmemo.com. You can update your preferences or unsubscribe at any time.
              </p>
              ${prefToken ? `
              <a href="http://localhost:3001/preferences.html?token=${prefToken}" style="font-family:${mono};font-size:10px;letter-spacing:2px;color:#00d4ff;text-decoration:none;text-transform:uppercase;">Update Preferences &rarr;</a>
              &nbsp;&nbsp;&middot;&nbsp;&nbsp;
              <a href="http://localhost:3001/unsubscribe.html?token=${prefToken}" style="font-family:${mono};font-size:10px;letter-spacing:2px;color:#6b7fa0;text-decoration:none;text-transform:uppercase;">Unsubscribe</a>
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
// Send the welcome email immediately after subscribe
//
// subscriber: { first_name, email, topics, delivery_time, pref_token }
// Fire-and-forget friendly — logs errors but does NOT throw
// ----------------------------------------------------------------
async function sendWelcomeEmail(subscriber) {
  const subject = `Welcome to Morning Memo, ${subscriber.first_name}`
  const body_html = buildWelcomeEmail(subscriber)

  try {
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: subscriber.email,
      subject,
      html: body_html
    })
    if (error) throw new Error(error.message)
    logger.info(`Welcome email sent to ${subscriber.email}`)
  } catch (err) {
    // Don't fail the subscription response — just log
    logger.error(`Failed to send welcome email to ${subscriber.email}`, err.message)
  }
}

// ----------------------------------------------------------------
// Send the newsletter and log the result to Supabase
//
// subscriber: full subscriber row from DB
// subject: string
// body_html: string (HTML email content)
// supabase: Supabase client instance (passed in from cron)
// dryRun: boolean — if true, skip actual send and DB log
//
// Returns: { success: boolean }
// ----------------------------------------------------------------
async function sendAndLog(subscriber, subject, body_html, supabase, dryRun = false) {
  if (dryRun) {
    logger.cron(`[DRY RUN] Would send to ${subscriber.email}`, { subject })
    return { success: true }
  }

  // --- Attempt to send via Resend (retry once on failure) ---
  let sendError = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { error } = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL,
        to: subscriber.email,
        subject,
        html: body_html
      })
      if (error) throw new Error(error.message)
      sendError = null
      break
    } catch (err) {
      sendError = err
      if (attempt < 2) {
        logger.warn(`Resend attempt ${attempt} failed for ${subscriber.email}, retrying…`, err.message)
        await new Promise(r => setTimeout(r, 1000))
      }
    }
  }

  // --- Log outcome to newsletters table ---
  const status = sendError ? 'failed' : 'sent'

  const { error: logError } = await supabase
    .from('newsletters')
    .insert({
      subscriber_id: subscriber.id,
      subject,
      body_html,
      delivery_time: subscriber.delivery_time,
      status
    })

  if (logError) {
    logger.error(`Failed to log newsletter for ${subscriber.email}`, logError)
    // Don't throw — logging failure shouldn't block the run
  }

  // --- Update last_sent_at only on successful send ---
  if (!sendError) {
    const { error: updateError } = await supabase
      .from('subscribers')
      .update({ last_sent_at: new Date().toISOString() })
      .eq('id', subscriber.id)

    if (updateError) {
      logger.error(`Failed to update last_sent_at for ${subscriber.email}`, updateError)
    }

    logger.cron(`Sent to ${subscriber.email}`, { subject })
    return { success: true }
  } else {
    logger.error(`Failed to send to ${subscriber.email} after 2 attempts`, sendError.message)
    return { success: false }
  }
}

// ----------------------------------------------------------------
// Exports
// ----------------------------------------------------------------
module.exports = { sendAndLog, sendWelcomeEmail }
