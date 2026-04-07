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
  'Technology':         'https://www.theverge.com/rss/index.xml',
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
  'thoughtco.com', 'reference.com', 'factmonster.com',
  'indianexpress.com'
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
// Vague/clickbait headline filter — blocks stories that withhold
// the core outcome (e.g. "makes a decision", "reveals his plans")
// These can never produce a useful summary regardless of prompt rules.
// ----------------------------------------------------------------
const VAGUE_TITLE_PATTERNS = [
  /\bmakes (a |his |her |their )?(retirement |career |final |big |major |surprise |shocking )?(decision|announcement|choice|move|call)\b/i,
  /\breveals (his|her|their) (plans|future|decision|next move|answer|secret|choice)\b/i,
  /\bannounces (his|her|their) (future|plans|decision|next step|choice)\b/i,
  /\b(what|here's what) (really )?(happened|he|she|they) (said|did|decided|chose)\b/i,
  /\bthe (truth|real reason|shocking truth) (about|behind|why)\b/i,
  /\byou (won't|will never) believe\b/i,
  /\bhere's (what|why|how) (you|he|she|they|it)\b/i,
  /\b(his|her|their) (shocking |surprising |stunning )?(response|reaction|answer|decision|admission)\b/i,
  /\bbreaks (his|her|their) silence\b/i,
  /\bsays (it )?all\b/i,
  // Outcome-without-cause: "opens door to", "paves the way for", "sets the stage for"
  /\b(opening|opens|open)\s+(the\s+)?door\s+to\b/i,
  /\b(paving|paves|pave)\s+the\s+way\s+for\b/i,
  /\b(setting|sets|set)\s+the\s+stage\s+for\b/i,
  // Vague cap/roster moves without naming the transaction
  /\bgains?\s+(salary\s+cap|cap)\s+(space|flexibility|room)\b/i,
  /\bcap\s+(space|flexibility|room)\b.*\broster\b/i,
  // Vague science/discovery — withholds the actual finding
  /\bin (unexpected|surprising|new|strange|bizarre|remarkable|fascinating) ways?\b/i,
  /\b(could|may|might) (change|reshape|revolutionize|transform) (the way|how|what) (we|scientists|researchers)\b/i,
  /\bscientists (still )?don'?t (fully )?understand\b/i,
  /\bnew (clues?|evidence|insight) (into|about|on) (the )?(mystery|secret|puzzle|question) of\b/i,
  // Headline-promises-answer-withholds-it: "Here's What Could Determine...", "What Could Drive...", etc.
  /\bhere's what (could|may|might|will|would) (determine|drive|decide|shape|define|affect|impact)\b/i,
  /\bwhat (could|may|might|will|would) (determine|drive|decide|shape|define|affect|impact) (a |the )?(recovery|outcome|result|future|direction|path|next)\b/i,
  // "What You Need to Know" — structurally never adds information beyond restating the headline
  /\bwhat you (need|should) (to )?know\b/i,
  // "The Key Question Is..." / "The Big Question..." — teases without answering
  /\bthe (key|big|central|real|burning|crucial|ultimate) question (is|facing|for|about|behind|now)\b/i,
  // "Could X Happen?" / "Will X?" clickbait speculation pieces
  /^(could|will|is|are|has|have|does|did|can|should|would) .{3,40}\?$/i,
  // Draft preview speculation — "Key Decision Ahead of Draft", "Options at WR", mock draft pieces
  /\bahead of (the )?(2\d{3} )?(nfl|nba|mlb|nhl|college)? ?draft\b/i,
  /\bmock draft\b/i,
  /\bdraft (board|capital|strategy|approach|options|decision|pick|needs?)\b/i,
  /\b(key|big|critical|important) (decision|choice|question|need) ahead of\b/i,
]

function isVagueHeadline(title) {
  if (!title) return false
  return VAGUE_TITLE_PATTERNS.some(re => re.test(title))
}

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
const MAX_ARTICLE_AGE_MS       = 7 * 24 * 60 * 60 * 1000
const MAX_SPORTS_ARTICLE_AGE_MS = 36 * 60 * 60 * 1000  // 36 hours — game recaps go stale fast

const SPORTS_TOPIC_KEYS = new Set([
  'Sports', 'NFL', 'NBA', 'MLB', 'NHL',
  'College Football', 'College Basketball', 'Soccer / MLS', 'Golf'
])

function isFreshArticle(dateStr, maxAgeMs = MAX_ARTICLE_AGE_MS) {
  if (!dateStr) return true
  const published = new Date(dateStr)
  if (isNaN(published.getTime())) return true
  return (Date.now() - published.getTime()) <= maxAgeMs
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
// Sports game recap filter — drops recap articles with no score.
// A score looks like "114-98", "3-1", "W 108-103", etc.
// Only applied to sports league feeds, not general sports content.
// ----------------------------------------------------------------
const GAME_RECAP_TITLE_PATTERNS = [
  /\b(defeat|defeats|beat|beats|beats|tops|tops|blanks|edges|outlasts|holds off|pulls off|clinches|overcomes|crushes|rolls|routs|downs)\b/i,
  /\b(win|wins|loss|loses|falls|falls to|rallies|rallies past|upsets|stunned|knocked out)\b/i,
]

const SCORE_PATTERN = /\b\d{1,3}[-–]\d{1,3}\b/

function isSportsRecapWithoutScore(title, summary, isSportsFeed) {
  if (!isSportsFeed) return false
  const text = `${title} ${summary}`
  const looksLikeRecap = GAME_RECAP_TITLE_PATTERNS.some(re => re.test(title))
  if (!looksLikeRecap) return false
  return !SCORE_PATTERN.test(text)
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
async function getCachedFeed(url, isSportsFeed = false) {
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
      .filter(s => !isVagueHeadline(s.title))
      .filter(s => !isSportsRecapWithoutScore(s.title, s.summary, isSportsFeed))
      .filter(s => s.summary && s.summary.trim().length >= 80)
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

// ----------------------------------------------------------------
// Niche subtopic queries — hand-crafted Google News searches for
// alternative focus areas across all topics.
// Key format: "Topic::Niche" → query string
// ----------------------------------------------------------------
const NICHE_QUERIES = {
  // Sports
  'Sports::Trading Cards & Memorabilia':   'sports trading card OR memorabilia OR card grading PSA BGS OR sports collectible auction',
  'Sports::Sports Business & Contracts':   'sports contract OR athlete salary OR sports deal OR franchise valuation OR sports rights deal',
  'Sports::Coaching Moves & Front Office': 'coach fired OR coach hired OR sports GM OR front office move OR head coach search',
  'Sports::Sports Records & Milestones':   'sports record broken OR all-time record athlete OR historic milestone sports',
  'Sports::Stadium & Arena News':          'stadium construction OR arena naming rights OR sports venue OR new stadium plan',
  // Finance
  'Finance::Billionaire Moves & Wealth':   'billionaire wealth OR Elon Musk investment OR Jeff Bezos deal OR ultra-wealthy OR Forbes billionaire news',
  'Finance::Mergers & Acquisitions':       'merger acquisition deal OR company buyout OR takeover bid OR M&A announced',
  'Finance::Small Business & Startups':    'small business owner economy OR main street business OR startup founder raised funding',
  'Finance::The Federal Reserve & Economy': 'Federal Reserve rate decision OR Fed chair Powell OR interest rate inflation economy',
  // Technology
  'Technology::Tech Failures & Scandals':  'tech company scandal OR data breach OR tech outage OR tech layoffs OR tech controversy',
  'Technology::Patents & Legal Battles':   'tech patent lawsuit OR Apple Google lawsuit OR intellectual property tech court',
  'Technology::Cybersecurity & Hacking':   'cyberattack hacking OR data breach security OR ransomware attack OR cybersecurity threat',
  'Technology::The Future of AI':          'artificial intelligence future OR AI regulation OR generative AI OR AI safety OR AI breakthrough',
  // Science
  'Science::Deep Ocean Discoveries':       'deep sea discovery OR ocean research OR marine biology OR undersea exploration OR deep ocean',
  'Science::Animal Kingdom Oddities':      'new species discovered OR animal behavior unusual OR rare creature OR animal discovery science',
  'Science::Extreme Weather & Natural Phenomena': 'extreme weather record OR natural disaster OR unusual weather phenomenon OR earthquake volcano tsunami',
  'Science::Space Exploration':            'space mission OR NASA OR SpaceX rocket OR astronaut OR Mars lunar OR space exploration',
  // Health
  'Health::Cutting-Edge Medical Treatments': 'new medical treatment OR clinical trial breakthrough OR FDA approval drug OR medical innovation',
  'Health::The Science of Sleep':          'sleep research OR sleep study OR insomnia science OR sleep deprivation OR circadian rhythm',
  'Health::Mental Health Breakthroughs':   'mental health research OR depression treatment new OR anxiety breakthrough OR psychiatry study',
  'Health::Longevity & Anti-Aging Research': 'longevity research OR anti-aging study OR lifespan extension OR centenarian OR aging reversal',
  // Arts & Culture
  'Arts & Culture::The Auction & Art Market': 'art auction record OR Christie\'s Sotheby\'s Phillips OR artwork sold OR art market OR fine art sale',
  'Arts & Culture::Music Industry & Business': 'record label deal OR music streaming rights OR artist contract OR music acquisition OR Spotify Apple Music',
  'Arts & Culture::Box Office & Film Business': 'box office results OR film revenue OR studio acquisition OR movie rights OR Hollywood deal',
  // Food & Travel
  'Food & Travel::Street Food Around the World': 'street food culture OR food market OR street food festival OR local cuisine tradition',
  'Food & Travel::Food Science & Innovation':    'food science OR lab-grown meat OR food technology OR food innovation OR sustainable food',
}

// Niche history subtopics get hand-crafted queries for best results
const HISTORY_NICHE_QUERIES = {
  'Lost Treasures & Shipwrecks':   'shipwreck discovered OR treasure found OR lost artifact recovered OR sunken ship OR buried treasure history',
  'People History Overlooked':     '"forgotten" OR "overlooked" OR "unsung" historical figure biography history',
  'Unsolved Historical Mysteries': 'historical mystery unsolved history cold case ancient unexplained',
  'Historic Items at Auction':     'historic item auction sold record price antique provenance',
  'Ancient Languages & Manuscripts': 'ancient language deciphered OR manuscript decoded OR inscription translated archaeology',
  'Stolen Art & Repatriation':     'stolen art recovered OR looted artifact repatriated OR art theft history',
  'Declassified & Secret Histories': 'declassified secret history espionage intelligence cold war hidden',
  'Food & Drink Through History':  'food history ancient cuisine OR historical recipe OR drink history archaeology'
}

function getTeamFeedUrl(teamName, leagueName) {
  let query

  // Check niche queries first (covers Sports, Finance, Technology, Science, Health, Arts, Food)
  const nicheKey = `${leagueName}::${teamName}`
  if (NICHE_QUERIES[nicheKey]) {
    query = NICHE_QUERIES[nicheKey]
  } else if (leagueName === 'History') {
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
        const stories = (await getCachedFeed(url, true)).filter(s => isFreshArticle(s.date, MAX_SPORTS_ARTICLE_AGE_MS))
        results.push({ topic, stories })
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

    const isSportsTopic = SPORTS_TOPIC_KEYS.has(topic)
    try {
      const allStories = await getCachedFeed(url, isSportsTopic)
      const stories = isSportsTopic
        ? allStories.filter(s => isFreshArticle(s.date, MAX_SPORTS_ARTICLE_AGE_MS))
        : allStories
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
