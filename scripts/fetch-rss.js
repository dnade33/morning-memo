// Morning Memo — RSS feed fetching with in-memory cache
// Also handles Local Weather via wttr.in (no API key required)
const Parser = require('rss-parser')
const { logger } = require('../logger')

const parser = new Parser()

// ----------------------------------------------------------------
// RSS feed map — topic name → feed URL
// ----------------------------------------------------------------
const RSS_FEEDS = {
  // Sports — generic fallback if no specific leagues chosen
  'Sports':             'https://www.espn.com/espn/rss/news',
  // Sports leagues
  'NFL':                'https://www.espn.com/espn/rss/nfl/news',
  'NBA':                'https://www.espn.com/espn/rss/nba/news',
  'MLB':                'https://www.espn.com/espn/rss/mlb/news',
  'NHL':                'https://www.espn.com/espn/rss/nhl/news',
  'College Football':   'https://www.espn.com/espn/rss/ncf/news',
  'College Basketball': 'https://www.espn.com/espn/rss/ncb/news',
  'Soccer / MLS':       'https://www.espn.com/espn/rss/soccer/news',
  'Golf':               'https://www.espn.com/espn/rss/golf/news',
  // News & interests
  'World News':         'https://feeds.reuters.com/reuters/topNews',
  'Politics':           'https://rss.politico.com/politics-news.xml',
  'Finance':            'https://search.cnbc.com/rs/search/combinedcms/view.php?partnerId=wrss01&id=100003114',
  'Technology':         'https://feeds.feedburner.com/TechCrunch',
  'Science':            'https://www.sciencedaily.com/rss/top/science.xml',
  'Health':             'https://rss.webmd.com/rss/rss.aspx?RSSSource=RSS_PUBLIC',
  'Arts & Culture':     'https://www.theguardian.com/culture/rss',
  'Food & Travel':      'https://www.theguardian.com/food/rss',
  'History':            'https://www.historynewsnetwork.org/rss.xml',
  'Books & Ideas':      'https://www.theguardian.com/books/rss',
}

// ----------------------------------------------------------------
// In-memory cache — cleared between cron time slots
// ----------------------------------------------------------------
const feedCache = {}

function clearFeedCache() {
  for (const key of Object.keys(feedCache)) {
    delete feedCache[key]
  }
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
      logger.warn(`[RETRY] Attempt ${i + 1} failed, retrying in ${delay}ms`, e.message)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

// ----------------------------------------------------------------
// Fetch + cache a single RSS feed URL
// Returns array of { title, summary, link, date }
// ----------------------------------------------------------------
async function getCachedFeed(url) {
  if (feedCache[url]) return feedCache[url]

  const stories = await fetchWithRetry(async () => {
    const feed = await parser.parseURL(url)
    return feed.items.slice(0, 5).map(item => ({
      title: item.title || '',
      summary: item.contentSnippet || item.content || item.summary || '',
      link: item.link || '',
      date: item.pubDate || ''
    }))
  })

  feedCache[url] = stories
  return stories
}

// ----------------------------------------------------------------
// Fetch local weather from wttr.in for a given city
// Returns a single story object so cron can treat it uniformly
// ----------------------------------------------------------------
async function getWeatherStory(city) {
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`

  const data = await fetchWithRetry(async () => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`wttr.in returned ${res.status} for city: ${city}`)
    return res.json()
  })

  const current = data.current_condition?.[0] || {}
  const tempF = current.temp_F || '?'
  const desc = current.weatherDesc?.[0]?.value || 'unknown conditions'
  const humidity = current.humidity || '?'
  const feelsLike = current.FeelsLikeF || '?'

  // Three-day forecast summary
  const forecast = (data.weather || []).slice(0, 3).map(day => {
    const hi = day.maxtempF
    const lo = day.mintempF
    const desc2 = day.hourly?.[4]?.weatherDesc?.[0]?.value || ''
    return `${day.date}: High ${hi}°F / Low ${lo}°F, ${desc2}`
  }).join(' | ')

  return {
    title: `Local Weather for ${city}`,
    summary: `Currently ${tempF}°F and ${desc} (feels like ${feelsLike}°F, humidity ${humidity}%). Forecast: ${forecast}`,
    link: `https://wttr.in/${encodeURIComponent(city)}`,
    date: new Date().toISOString()
  }
}

// ----------------------------------------------------------------
// Team-specific Google News RSS feed
// Topic format from cron: "League::Team" (e.g. "NHL::Devils")
// ----------------------------------------------------------------
function getTeamFeedUrl(teamName, leagueName) {
  const query = `${teamName} ${leagueName}`
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
}

// ----------------------------------------------------------------
// Main export: get all stories for a subscriber's topics
//
// Returns: { topic: string, stories: Story[] }[]
// Missing feeds are skipped with a warning (don't crash the run)
// ----------------------------------------------------------------
async function getCachedStories(topics, city) {
  const results = []

  for (const topic of topics) {
    // Special case: Local Weather uses wttr.in
    if (topic === 'Local Weather') {
      if (!city) {
        logger.warn('Local Weather topic selected but no city provided — skipping')
        continue
      }
      try {
        const story = await getWeatherStory(city)
        results.push({ topic, stories: [story] })
      } catch (err) {
        logger.warn(`Weather fetch failed for city: ${city}`, err.message)
      }
      continue
    }

    // Team-specific topic: "League::Team" (e.g. "NHL::Devils")
    if (topic.includes('::')) {
      const [league, team] = topic.split('::')
      const url = getTeamFeedUrl(team, league)
      try {
        const stories = await getCachedFeed(url)
        results.push({ topic: team, leagueFallback: league, stories })
      } catch (err) {
        logger.warn(`Team feed fetch failed for ${team} (${league})`, err.message)
      }
      continue
    }

    // Standard RSS topics
    const url = RSS_FEEDS[topic]
    if (!url) {
      logger.warn(`No RSS feed mapped for topic: ${topic} — skipping`)
      continue
    }

    try {
      const stories = await getCachedFeed(url)
      results.push({ topic, stories })
    } catch (err) {
      logger.warn(`RSS fetch failed for topic: ${topic}`, err.message)
      // Skip this topic's stories rather than failing the whole subscriber
    }
  }

  return results
}

// ----------------------------------------------------------------
// Exports
// ----------------------------------------------------------------
module.exports = {
  getRSSFeedMap: () => RSS_FEEDS,
  getCachedStories,
  clearFeedCache
}
