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
// Reference article filter — blocks encyclopedia/definition content
// that has no news value (Britannica, Wikipedia, "What is X?" etc.)
// ----------------------------------------------------------------
const BLOCKED_DOMAINS = [
  'britannica.com', 'wikipedia.org', 'wikimedia.org',
  'merriam-webster.com', 'dictionary.com', 'encyclopedia.com',
  'thoughtco.com', 'reference.com', 'factmonster.com'
]

const REFERENCE_TITLE_PATTERNS = [
  /\|\s*definition\b/i,
  /\|\s*encyclopedia/i,
  /\|\s*britannica/i,
  /\|\s*wikipedia/i,
  /^what is\b/i,
  /^what are\b/i,
  /\bdefinition of\b/i,
  /:\s*a (complete\s+)?(guide|primer|overview|introduction|history)$/i,
  /\|\s*definition,\s*history/i,
  /\|\s*types,?\s*(and\s+)?facts/i,
  /\bexplained\b.*:\s*everything you need to know/i,
  // Investopedia-style definitional titles ("X Explained: Definition...", "X: What It Is", etc.)
  /:\s*definition\b/i,
  /:\s*what it is\b/i,
  /:\s*how it works\b/i,
  /\bdefinition,\s*(types?|examples?|how)\b/i,
]

// ----------------------------------------------------------------
// Listicle / roundup filter — blocks "Top N…", "10 Best…", year-end
// roundups, and other list-format articles that produce vague summaries.
// These are structurally incapable of yielding specific news coverage.
// ----------------------------------------------------------------
const LISTICLE_TITLE_PATTERNS = [
  // "Top 7 …" / "The Top 10 …"
  /^(the\s+)?top\s+\d+\b/i,
  // "7 Best …" / "10 Ways to …" / "5 Things You Should …"
  /^\d+\s+(best|top|worst|ways|tips|things|reasons|facts|signs|steps|tricks|hacks|ideas|questions|examples|lessons|mistakes|myths|trends|secrets|rules|habits)\b/i,
  // "The 10 Best …" / "The 5 Most …"
  /^the\s+\d+\s+(best|most|worst|top)\b/i,
  // "Best of 2025" / "Best of the Year"
  /\bbest\s+of\s+(the\s+)?(year|\d{4})\b/i,
  // "2025 in Review" / "Year in Review"
  /\b(year|\d{4})\s+in\s+review\b/i,
  // "Year-End Roundup / Recap / Wrap-Up"
  /\byear.?end\s+(roundup|recap|list|review|guide|picks|wrap.?up)\b/i,
  // "Stories / Moments / Highlights of the Year / 2025"
  /\b(stories|moments|events|highlights|trends)\s+of\s+(the\s+)?(year|\d{4})\b/i,
]

// ----------------------------------------------------------------
// Freshness filter — drops articles older than 7 days.
// Articles with no date or an unparseable date are kept (safe default).
// ----------------------------------------------------------------
const MAX_ARTICLE_AGE_MS = 7 * 24 * 60 * 60 * 1000

function isFreshArticle(dateStr) {
  if (!dateStr) return true
  const published = new Date(dateStr)
  if (isNaN(published.getTime())) return true
  return (Date.now() - published.getTime()) <= MAX_ARTICLE_AGE_MS
}

function isReferenceArticle(title, link) {
  if (!title) return false
  if (link) {
    try {
      const hostname = new URL(link).hostname.replace(/^www\./, '')
      if (BLOCKED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))) return true
    } catch { /* ignore malformed links */ }
  }
  return REFERENCE_TITLE_PATTERNS.some(re => re.test(title)) ||
         LISTICLE_TITLE_PATTERNS.some(re => re.test(title))
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
    return feed.items
      .map(item => ({
        title: item.title || '',
        summary: item.contentSnippet || item.content || item.summary || '',
        link: item.link || '',
        date: item.pubDate || ''
      }))
      .filter(s => isFreshArticle(s.date))
      .filter(s => !isReferenceArticle(s.title, s.link))
      .slice(0, 5)
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
// Google News RSS feed for a subtopic search
// Topic format from cron: "Parent::Subtopic" (e.g. "NHL::Devils", "History::Medieval")
// History subtopics get a discovery/archaeology bias so results feel
// like genuine historical content rather than contemporary media coverage.
// ----------------------------------------------------------------
const HISTORY_ERA_SUBTOPICS = new Set([
  'Medieval', 'Ancient Rome', 'Ancient Greece', 'Ancient Egypt', 'Renaissance',
  'World War II', 'World War I', 'American Revolution', 'Civil War',
  'Cold War', 'Byzantine', 'Viking', 'Ottoman', 'Aztec', 'Inca', 'Mayan',
  'Ancient Civilizations', 'Roman Empire', 'Age of Exploration',
  'Industrial Revolution', 'Victorian Era', 'American History', 'World War I & II',
  'Modern History (1980s–present)'
])

// Niche history subtopics get hand-crafted queries for best results
const HISTORY_NICHE_QUERIES = {
  'Lost & Found':                 'shipwreck discovered OR treasure found OR lost artifact recovered OR sunken ship OR buried treasure history',
  'Forgotten Figures':            '"forgotten" OR "overlooked" OR "unsung" historical figure biography history',
  'Historical Mysteries':         'historical mystery unsolved history cold case ancient unexplained',
  'Auction Block':                'historic item auction sold record price antique provenance',
  'Decoded & Deciphered':         'ancient language deciphered OR manuscript decoded OR inscription translated archaeology',
  'Stolen & Recovered':           'stolen art recovered OR looted artifact repatriated OR art theft history',
  'Secret Histories':             'declassified secret history espionage intelligence cold war hidden',
  'Food & Drink Through History': 'food history ancient cuisine OR historical recipe OR drink history archaeology'
}

function getTeamFeedUrl(teamName, leagueName) {
  let query
  if (leagueName === 'History') {
    if (HISTORY_NICHE_QUERIES[teamName]) {
      query = HISTORY_NICHE_QUERIES[teamName]
    } else if (HISTORY_ERA_SUBTOPICS.has(teamName)) {
      query = `${teamName} (discovery OR archaeology OR excavation OR artifact OR research OR historian)`
    } else {
      query = `${teamName} history`
    }
  } else {
    query = `${teamName} ${leagueName}`
  }
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
