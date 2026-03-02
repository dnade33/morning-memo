// Morning Memo — Logger utility
const isDev = process.env.NODE_ENV === 'development'

const logger = {
  info:  (msg, data) => console.log(`[INFO]  ${msg}`, data || ''),
  warn:  (msg, data) => console.warn(`[WARN]  ${msg}`, data || ''),
  error: (msg, err)  => console.error(`[ERROR] ${msg}`, err || ''),
  debug: (msg, data) => isDev && console.debug(`[DEBUG] ${msg}`, data || ''),
  cron:  (msg, data) => console.log(`[CRON]  ${new Date().toISOString()} — ${msg}`, data || ''),
}

module.exports = { logger }
