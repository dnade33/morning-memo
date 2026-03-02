// Morning Memo — Email preview generator
// Builds a sample email and opens it in your browser instantly.
// No API calls, no Supabase, no RSS fetching.
//
// Usage: node preview.js

const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const { buildMissionControlEmail } = require('./scripts/generate-newsletter')

// ----------------------------------------------------------------
// Sample content — edit this to test different scenarios
// ----------------------------------------------------------------
const sampleParsed = {
  greeting: "Good morning, Doug. It's a crisp 43°F and sunny in Newark today — bundle up, but the weather's cooperating for once.",

  topics: [
    {
      name: 'Finance',
      stories: [
        {
          headline: 'Markets stumble as inflation data stokes rate concerns',
          body: 'Wholesale prices jumped 0.8% in January, exceeding expectations and sending the Dow down 600 points. The hotter-than-expected core producer price index has traders worried the Fed\'s inflation fight isn\'t over, rattling confidence in tech stocks like Nvidia that had powered recent gains.'
        },
        {
          headline: 'UBS downgrade signals end of U.S. stock outperformance era',
          body: 'The investment bank downgraded U.S. equities to "benchmark," suggesting the tailwinds that drove American markets higher are fading. This marks a notable shift in conviction from one of Wall Street\'s major players and hints at a potential rotation away from concentrated big-cap bets.'
        },
        {
          headline: 'OpenAI and Anthropic find common ground on AI safety',
          body: 'The two leading AI labs issued a rare joint statement supporting voluntary safety commitments ahead of upcoming Senate hearings. The move signals an industry-wide effort to get ahead of regulation before Congress acts unilaterally on frontier model development.'
        }
      ]
    },
    {
      name: 'Science',
      stories: [
        {
          headline: "Titan may have been born in a celestial collision",
          body: "Saturn's largest moon likely formed when two ancient moons crashed together hundreds of millions of years ago, according to new research into its unusual orbit and smooth surface. This cataclysm may have also triggered the formation of Saturn's iconic rings, reshaping the entire moon system in the process."
        },
        {
          headline: "Universe's earliest barred spiral galaxy spotted just 2 billion years after the Big Bang",
          body: "The James Webb Space Telescope has identified COSMOS-74706, a galaxy with a stellar bar structure remarkably similar to our Milky Way, dating back 11.5 billion years. The discovery pushes back the timeline for when complex galactic structures formed in the young universe."
        }
      ]
    },
    {
      name: 'Local Weather',
      stories: [
        {
          headline: 'Sunny today with frigid nights ahead',
          body: 'Newark stays sunny through today with a high near 43°F, but expect the mercury to plummet to 24°F tonight. The cold snap continues into the weekend with fog likely Friday and clouds by Saturday.'
        }
      ]
    }
  ],

  quote: {
    text: 'The obstacle is the way.',
    attribution: 'Marcus Aurelius'
  }
}

// ----------------------------------------------------------------
// Generate and save
// ----------------------------------------------------------------
const formattedDate = new Date().toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
})

const html = buildMissionControlEmail(sampleParsed, 'Doug', formattedDate)

const outputPath = path.join(__dirname, '.workspace', 'preview.html')
fs.writeFileSync(outputPath, html)

console.log(`Preview saved to: ${outputPath}`)
exec(`open "${outputPath}"`)
