// Morning Memo — Newsletter generation via Claude Haiku
const Anthropic = require('@anthropic-ai/sdk')
const { logger } = require('../logger')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ----------------------------------------------------------------
// Quote style resolver
// ----------------------------------------------------------------
const QUOTE_STYLES = [
  'Inspirational', 'Philosophical', 'Stoic', 'Humor & Wit',
  'Historical', 'Literary', 'Science & Discovery'
]

// Curated quote pool — dedup handled entirely in code, Claude is not involved.
// ~25 quotes per style ensures months of variety before any repeat.
const QUOTE_POOL = {
  'Inspirational': [
    { text: 'Do what you can, with what you have, where you are.', attribution: 'Theodore Roosevelt' },
    { text: 'It does not matter how slowly you go as long as you do not stop.', attribution: 'Confucius' },
    { text: 'You are never too old to set another goal or to dream a new dream.', attribution: 'C.S. Lewis' },
    { text: 'Start where you are. Use what you have. Do what you can.', attribution: 'Arthur Ashe' },
    { text: 'The best time to plant a tree was 20 years ago. The second best time is now.', attribution: 'Chinese Proverb' },
    { text: 'Act as if what you do makes a difference. It does.', attribution: 'William James' },
    { text: 'Success is not final, failure is not fatal: it is the courage to continue that counts.', attribution: 'Winston Churchill' },
    { text: 'Everything you\'ve ever wanted is on the other side of fear.', attribution: 'George Addair' },
    { text: 'The only limit to our realization of tomorrow is our doubts of today.', attribution: 'Franklin D. Roosevelt' },
    { text: 'You miss 100% of the shots you don\'t take.', attribution: 'Wayne Gretzky' },
    { text: 'Whether you think you can or you think you can\'t, you\'re right.', attribution: 'Henry Ford' },
    { text: 'It always seems impossible until it\'s done.', attribution: 'Nelson Mandela' },
    { text: 'Don\'t watch the clock; do what it does. Keep going.', attribution: 'Sam Levenson' },
    { text: 'I have not failed. I\'ve just found 10,000 ways that won\'t work.', attribution: 'Thomas Edison' },
    { text: 'Our greatest glory is not in never falling, but in rising every time we fall.', attribution: 'Confucius' },
    { text: 'Keep your face always toward the sunshine, and shadows will fall behind you.', attribution: 'Walt Whitman' },
    { text: 'Life is 10% what happens to you and 90% how you react to it.', attribution: 'Charles R. Swindoll' },
    { text: 'Spread love everywhere you go. Let no one ever come to you without leaving happier.', attribution: 'Mother Teresa' },
    { text: 'Do not go where the path may lead; go instead where there is no path and leave a trail.', attribution: 'Ralph Waldo Emerson' },
    { text: 'You will face many defeats in life, but never let yourself be defeated.', attribution: 'Maya Angelou' },
    { text: 'The most common way people give up their power is by thinking they don\'t have any.', attribution: 'Alice Walker' },
    { text: 'Darkness cannot drive out darkness; only light can do that.', attribution: 'Martin Luther King Jr.' },
    { text: 'Isn\'t it nice to think that tomorrow is a new day with no mistakes in it yet?', attribution: 'L.M. Montgomery' },
    { text: 'We must accept finite disappointment, but never lose infinite hope.', attribution: 'Martin Luther King Jr.' },
    { text: 'If you want to lift yourself up, lift up someone else.', attribution: 'Booker T. Washington' },
  ],
  'Philosophical': [
    { text: 'The unexamined life is not worth living.', attribution: 'Socrates' },
    { text: 'I think, therefore I am.', attribution: 'René Descartes' },
    { text: 'Man is condemned to be free.', attribution: 'Jean-Paul Sartre' },
    { text: 'That which does not kill us makes us stronger.', attribution: 'Friedrich Nietzsche' },
    { text: 'One must imagine Sisyphus happy.', attribution: 'Albert Camus' },
    { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', attribution: 'Aristotle' },
    { text: 'The measure of a man is what he does with power.', attribution: 'Plato' },
    { text: 'No man ever steps in the same river twice.', attribution: 'Heraclitus' },
    { text: 'The only true wisdom is in knowing you know nothing.', attribution: 'Socrates' },
    { text: 'Reality is merely an illusion, albeit a very persistent one.', attribution: 'Albert Einstein' },
    { text: 'Two things are infinite: the universe and human stupidity; and I\'m not sure about the universe.', attribution: 'Albert Einstein' },
    { text: 'Yesterday I was clever, so I wanted to change the world. Today I am wise, so I am changing myself.', attribution: 'Rumi' },
    { text: 'The good life is one inspired by love and guided by knowledge.', attribution: 'Bertrand Russell' },
    { text: 'The price of anything is the amount of life you exchange for it.', attribution: 'Henry David Thoreau' },
    { text: 'We don\'t see things as they are, we see them as we are.', attribution: 'Anaïs Nin' },
    { text: 'A man who dares to waste one hour of time has not discovered the value of life.', attribution: 'Charles Darwin' },
    { text: 'In three words I can sum up everything I\'ve learned about life: it goes on.', attribution: 'Robert Frost' },
    { text: 'It is not the strongest of the species that survive, nor the most intelligent, but the one most responsive to change.', attribution: 'Charles Darwin' },
    { text: 'What we observe is not nature itself, but nature exposed to our method of questioning.', attribution: 'Werner Heisenberg' },
    { text: 'To live is to suffer; to survive is to find meaning in the suffering.', attribution: 'Friedrich Nietzsche' },
    { text: 'The function of education is to teach one to think intensively and to think critically.', attribution: 'Martin Luther King Jr.' },
    { text: 'He who thinks great thoughts often makes great errors.', attribution: 'Martin Heidegger' },
    { text: 'The pendulum of the mind alternates between sense and nonsense, not between right and wrong.', attribution: 'Carl Jung' },
    { text: 'Man is the only creature who refuses to be what he is.', attribution: 'Albert Camus' },
    { text: 'Freedom is nothing but a chance to be better.', attribution: 'Albert Camus' },
  ],
  'Stoic': [
    { text: 'Waste no more time arguing about what a good man should be. Be one.', attribution: 'Marcus Aurelius' },
    { text: 'The happiness of your life depends upon the quality of your thoughts.', attribution: 'Marcus Aurelius' },
    { text: 'He who fears death will never do anything worthy of a man who is alive.', attribution: 'Seneca' },
    { text: 'We suffer more often in imagination than in reality.', attribution: 'Seneca' },
    { text: 'If it is not right, do not do it; if it is not true, do not say it.', attribution: 'Marcus Aurelius' },
    { text: 'Begin at once to live, and count each separate day as a separate life.', attribution: 'Seneca' },
    { text: 'The impediment to action advances action. What stands in the way becomes the way.', attribution: 'Marcus Aurelius' },
    { text: 'Receive without pride, relinquish without struggle.', attribution: 'Marcus Aurelius' },
    { text: 'He is a wise man who does not grieve for the things which he has not, but rejoices for those which he has.', attribution: 'Epictetus' },
    { text: 'Make the best use of what is in your power, and take the rest as it happens.', attribution: 'Epictetus' },
    { text: 'First say to yourself what you would be; and then do what you have to do.', attribution: 'Epictetus' },
    { text: 'No great thing is created suddenly.', attribution: 'Epictetus' },
    { text: 'Seek not the good in external things; seek it in yourself.', attribution: 'Epictetus' },
    { text: 'Confine yourself to the present.', attribution: 'Marcus Aurelius' },
    { text: 'The object of life is not to be on the side of the majority, but to escape finding oneself in the ranks of the insane.', attribution: 'Marcus Aurelius' },
    { text: 'Loss is nothing else but change, and change is Nature\'s delight.', attribution: 'Marcus Aurelius' },
    { text: 'The soul becomes dyed with the color of its thoughts.', attribution: 'Marcus Aurelius' },
    { text: 'Dwell on the beauty of life. Watch the stars, and see yourself running with them.', attribution: 'Marcus Aurelius' },
    { text: 'Very little is needed to make a happy life; it is all within yourself, in your way of thinking.', attribution: 'Marcus Aurelius' },
    { text: 'You have power over your mind, not outside events. Realize this, and you will find strength.', attribution: 'Marcus Aurelius' },
    { text: 'It is not that I am brave, but that I choose to be brave.', attribution: 'Epictetus' },
    { text: 'Wealth consists not in having great possessions, but in having few wants.', attribution: 'Epictetus' },
    { text: 'Do not indulge in expectations about what you do not control.', attribution: 'Epictetus' },
    { text: 'How long are you going to wait before you demand the best for yourself?', attribution: 'Epictetus' },
    { text: 'It\'s not what happens to you, but how you react to it that matters.', attribution: 'Epictetus' },
  ],
  'Humor & Wit': [
    { text: 'The trouble with having an open mind is that people will insist on coming along and trying to put things in it.', attribution: 'Terry Pratchett' },
    { text: 'I find television very educational. Every time someone turns it on, I go in the other room and read a book.', attribution: 'Groucho Marx' },
    { text: 'Outside of a dog, a book is man\'s best friend. Inside of a dog, it\'s too dark to read.', attribution: 'Groucho Marx' },
    { text: 'I always wanted to be somebody, but now I realize I should have been more specific.', attribution: 'Lily Tomlin' },
    { text: 'Age is an issue of mind over matter. If you don\'t mind, it doesn\'t matter.', attribution: 'Mark Twain' },
    { text: 'The brain is a wonderful organ; it starts working the moment you get up in the morning and does not stop until you get into a meeting.', attribution: 'Robert Frost' },
    { text: 'If at first you don\'t succeed, skydiving is not for you.', attribution: 'Steven Wright' },
    { text: 'People say nothing is impossible, but I do nothing every day.', attribution: 'A.A. Milne' },
    { text: 'Light travels faster than sound. This is why some people appear bright until you hear them speak.', attribution: 'Alan Dundes' },
    { text: 'The average dog is a nicer person than the average person.', attribution: 'Andy Rooney' },
    { text: 'At every party there are two kinds of people — those who want to go home and those who don\'t. The trouble is, they are usually married to each other.', attribution: 'Ann Landers' },
    { text: 'Always borrow money from a pessimist. He won\'t expect it back.', attribution: 'Oscar Wilde' },
    { text: 'Do not take life too seriously. You will never get out of it alive.', attribution: 'Elbert Hubbard' },
    { text: 'I was married by a judge. I should have asked for a jury.', attribution: 'Groucho Marx' },
    { text: 'A day without sunshine is like, you know, night.', attribution: 'Steve Martin' },
    { text: 'As you get older, three things happen. The first is your memory goes, and I can\'t remember the other two.', attribution: 'Norman Wisdom' },
    { text: 'I am so clever that sometimes I don\'t understand a single word of what I am saying.', attribution: 'Oscar Wilde' },
    { text: 'The secret of a good sermon is to have a good beginning and a good ending, then having the two as close together as possible.', attribution: 'George Burns' },
    { text: 'Before you judge a man, walk a mile in his shoes. After that, who cares? He\'s a mile away and you\'ve got his shoes.', attribution: 'Billy Connolly' },
    { text: 'I can resist everything except temptation.', attribution: 'Oscar Wilde' },
    { text: 'Be yourself; everyone else is already taken.', attribution: 'Oscar Wilde' },
    { text: 'We are all here on earth to help others; what on earth the others are here for I don\'t know.', attribution: 'W.H. Auden' },
    { text: 'I never forget a face, but in your case I\'ll be glad to make an exception.', attribution: 'Groucho Marx' },
    { text: 'A good speech should be like a woman\'s skirt: long enough to cover the subject and short enough to create interest.', attribution: 'Winston Churchill' },
    { text: 'Opportunity is missed by most people because it is dressed in overalls and looks like work.', attribution: 'Thomas Edison' },
  ],
  'Historical': [
    { text: 'Give me liberty, or give me death!', attribution: 'Patrick Henry' },
    { text: 'An eye for an eye only ends up making the whole world blind.', attribution: 'Mahatma Gandhi' },
    { text: 'Be the change you wish to see in the world.', attribution: 'Mahatma Gandhi' },
    { text: 'Injustice anywhere is a threat to justice everywhere.', attribution: 'Martin Luther King Jr.' },
    { text: 'Education is the most powerful weapon which you can use to change the world.', attribution: 'Nelson Mandela' },
    { text: 'History will be kind to me for I intend to write it.', attribution: 'Winston Churchill' },
    { text: 'Success is walking from failure to failure with no loss of enthusiasm.', attribution: 'Winston Churchill' },
    { text: 'The ballot is stronger than the bullet.', attribution: 'Abraham Lincoln' },
    { text: 'Nearly all men can stand adversity, but if you want to test a man\'s character, give him power.', attribution: 'Abraham Lincoln' },
    { text: 'You can fool all the people some of the time, and some of the people all the time, but you cannot fool all the people all the time.', attribution: 'Abraham Lincoln' },
    { text: 'I have learned that people will forget what you said, people will forget what you did, but people will never forget how you made them feel.', attribution: 'Maya Angelou' },
    { text: 'No one can make you feel inferior without your consent.', attribution: 'Eleanor Roosevelt' },
    { text: 'Do one thing every day that scares you.', attribution: 'Eleanor Roosevelt' },
    { text: 'Great minds discuss ideas; average minds discuss events; small minds discuss people.', attribution: 'Eleanor Roosevelt' },
    { text: 'In the long run, we shape our lives, and we shape ourselves. The process never ends until we die.', attribution: 'Eleanor Roosevelt' },
    { text: 'I am not afraid of storms, for I am learning how to sail my ship.', attribution: 'Louisa May Alcott' },
    { text: 'Float like a butterfly, sting like a bee.', attribution: 'Muhammad Ali' },
    { text: 'Ask not what your country can do for you — ask what you can do for your country.', attribution: 'John F. Kennedy' },
    { text: 'Mankind must put an end to war before war puts an end to mankind.', attribution: 'John F. Kennedy' },
    { text: 'The time is always right to do what is right.', attribution: 'Martin Luther King Jr.' },
    { text: 'I am not an Athenian or a Greek, but a citizen of the world.', attribution: 'Socrates' },
    { text: 'We shall fight on the beaches, we shall fight on the landing grounds, we shall fight in the fields and in the streets.', attribution: 'Winston Churchill' },
    { text: 'To improve is to change; to be perfect is to change often.', attribution: 'Winston Churchill' },
    { text: 'The most courageous act is still to think for yourself. Aloud.', attribution: 'Coco Chanel' },
    { text: 'I am not afraid; I was born to do this.', attribution: 'Joan of Arc' },
  ],
  'Literary': [
    { text: 'Not all those who wander are lost.', attribution: 'J.R.R. Tolkien' },
    { text: 'It does not do to dwell on dreams and forget to live.', attribution: 'J.K. Rowling' },
    { text: 'All that is gold does not glitter.', attribution: 'J.R.R. Tolkien' },
    { text: 'The world is a book, and those who do not travel read only one page.', attribution: 'Saint Augustine' },
    { text: 'There is nothing either good or bad, but thinking makes it so.', attribution: 'William Shakespeare' },
    { text: 'All the world\'s a stage, and all the men and women merely players.', attribution: 'William Shakespeare' },
    { text: 'We know what we are, but know not what we may be.', attribution: 'William Shakespeare' },
    { text: 'The fault, dear Brutus, is not in our stars, but in ourselves.', attribution: 'William Shakespeare' },
    { text: 'So we beat on, boats against the current, borne back ceaselessly into the past.', attribution: 'F. Scott Fitzgerald' },
    { text: 'I took a deep breath and listened to the old brag of my heart: I am, I am, I am.', attribution: 'Sylvia Plath' },
    { text: 'You never really understand a person until you consider things from his point of view.', attribution: 'Harper Lee' },
    { text: 'Until I feared I would lose it, I never loved to read. One does not love breathing.', attribution: 'Harper Lee' },
    { text: 'Good friends, good books, and a sleepy conscience: this is the ideal life.', attribution: 'Mark Twain' },
    { text: 'Whenever you feel like criticizing anyone, remember that all the people in this world haven\'t had the advantages that you\'ve had.', attribution: 'F. Scott Fitzgerald' },
    { text: 'It was a bright cold day in April, and the clocks were striking thirteen.', attribution: 'George Orwell' },
    { text: 'All animals are equal, but some animals are more equal than others.', attribution: 'George Orwell' },
    { text: 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.', attribution: 'Jane Austen' },
    { text: 'I am not afraid of tomorrow, for I have seen yesterday and I love today.', attribution: 'William Allen White' },
    { text: 'It is a far, far better thing that I do, than I have ever done.', attribution: 'Charles Dickens' },
    { text: 'There is no friend as loyal as a book.', attribution: 'Ernest Hemingway' },
    { text: 'The world breaks everyone, and afterward, some are strong at the broken places.', attribution: 'Ernest Hemingway' },
    { text: 'If you only read the books that everyone else is reading, you can only think what everyone else is thinking.', attribution: 'Haruki Murakami' },
    { text: 'A reader lives a thousand lives before he dies. The man who never reads lives only one.', attribution: 'George R.R. Martin' },
    { text: 'We accept the love we think we deserve.', attribution: 'Stephen Chbosky' },
    { text: 'You have brains in your head. You have feet in your shoes. You can steer yourself any direction you choose.', attribution: 'Dr. Seuss' },
  ],
  'Science & Discovery': [
    { text: 'Science is not only compatible with spirituality; it is a profound source of spirituality.', attribution: 'Carl Sagan' },
    { text: 'The cosmos is within us. We are made of star-stuff.', attribution: 'Carl Sagan' },
    { text: 'Somewhere, something incredible is waiting to be known.', attribution: 'Carl Sagan' },
    { text: 'The good thing about science is that it\'s true whether or not you believe in it.', attribution: 'Neil deGrasse Tyson' },
    { text: 'We are a way for the cosmos to know itself.', attribution: 'Carl Sagan' },
    { text: 'The most beautiful thing we can experience is the mysterious. It is the source of all true art and science.', attribution: 'Albert Einstein' },
    { text: 'Imagination is more important than knowledge.', attribution: 'Albert Einstein' },
    { text: 'If you can\'t explain it simply, you don\'t understand it well enough.', attribution: 'Albert Einstein' },
    { text: 'Nothing in life is to be feared; it is only to be understood.', attribution: 'Marie Curie' },
    { text: 'Life is not easy for any of us. But what of that? We must have perseverance and, above all, confidence in ourselves.', attribution: 'Marie Curie' },
    { text: 'I have no special talent. I am only passionately curious.', attribution: 'Albert Einstein' },
    { text: 'Science is a way of thinking much more than it is a body of knowledge.', attribution: 'Carl Sagan' },
    { text: 'Research is seeing what everybody else has seen and thinking what nobody else has thought.', attribution: 'Albert Szent-Györgyi' },
    { text: 'The first principle is that you must not fool yourself — and you are the easiest person to fool.', attribution: 'Richard Feynman' },
    { text: 'I would rather have questions that can\'t be answered than answers that can\'t be questioned.', attribution: 'Richard Feynman' },
    { text: 'Nature uses only the longest threads to weave her patterns, so each small piece of her fabric reveals the organization of the entire tapestry.', attribution: 'Richard Feynman' },
    { text: 'In questions of science, the authority of a thousand is not worth the humble reasoning of a single individual.', attribution: 'Galileo Galilei' },
    { text: 'All truths are easy to understand once they are discovered; the point is to discover them.', attribution: 'Galileo Galilei' },
    { text: 'The universe is not required to be in perfect harmony with human ambition.', attribution: 'Carl Sagan' },
    { text: 'An experiment is a question which science poses to Nature, and a measurement is the recording of Nature\'s answer.', attribution: 'Max Planck' },
    { text: 'The important thing is not to stop questioning.', attribution: 'Albert Einstein' },
    { text: 'What is a scientist after all? It is a curious man looking through a keyhole.', attribution: 'Jacques-Yves Cousteau' },
    { text: 'The science of today is the technology of tomorrow.', attribution: 'Edward Teller' },
    { text: 'We shall not cease from exploration, and the end of all our exploring will be to arrive where we started and know the place for the first time.', attribution: 'T.S. Eliot' },
    { text: 'Physics is like sex: sure, it may give some practical results, but that\'s not why we do it.', attribution: 'Richard Feynman' },
  ],
}

// Pick a quote from the pool that hasn't been used recently.
// Falls back to a random pool quote if all have been used (very unlikely with 25+ per style).
function pickQuote(style, recentQuotes = []) {
  const pool = QUOTE_POOL[style] || QUOTE_POOL['Inspirational']
  const usedTexts = new Set(recentQuotes.map(q => q.text?.toLowerCase().trim()).filter(Boolean))
  const fresh = pool.filter(q => !usedTexts.has(q.text.toLowerCase().trim()))
  const candidates = fresh.length > 0 ? fresh : pool
  return candidates[Math.floor(Math.random() * candidates.length)]
}

function resolveQuoteStyle(style) {
  if (style === 'Surprise Me') {
    return QUOTE_STYLES[Math.floor(Math.random() * QUOTE_STYLES.length)]
  }
  return style
}

// ----------------------------------------------------------------
// Prompt builder — passes stories grouped by topic
// Uses custom markers so the response is reliably parseable
// ----------------------------------------------------------------
// ----------------------------------------------------------------
// Story allocation: min 6 total, max 10.
// ≥6 topics → 1 per topic. <6 topics → fill to 6 by giving extra
// stories to topics with the most subtopics selected.
// ----------------------------------------------------------------
function calculateStoryAllocation(subscriber, topicStories) {
  const MAX_STORIES = 8
  const allocation = {}

  // If more panels than max, only include the first MAX_STORIES panels
  const cappedTopics = topicStories.slice(0, MAX_STORIES)
  for (const { topic } of cappedTopics) allocation[topic] = 1

  if (cappedTopics.length < 6) {
    let remaining = 6 - cappedTopics.length
    const sorted = [...cappedTopics].sort((a, b) =>
      (subscriber.preferences?.[b.topic] || []).length -
      (subscriber.preferences?.[a.topic] || []).length
    )
    let i = 0
    while (remaining > 0) {
      allocation[sorted[i % sorted.length].topic]++
      remaining--
      i++
    }
  }

  return allocation
}

function buildPrompt(subscriber, topicStories, allocation, recentTitles = []) {
  const topicBlocks = topicStories.map(({ topic, stories }) => {
    const count = allocation[topic] || 1
    const subtopics = subscriber.preferences?.[topic]
    const subtopicLine = subtopics && subtopics.length > 0
      ? `  Subscriber's specific interests within ${topic}: ${subtopics.join(', ')}`
      : ''
    const storyList = stories
      .slice(0, 6)
      .map((s, i) => `  Story ${i + 1}:\n  Title: ${s.title}\n  Summary: ${s.summary}${s.link ? `\n  Link: ${s.link}` : ''}`)
      .join('\n\n')
    return `TOPIC: ${topic} [Write exactly ${count} ${count === 1 ? 'story' : 'stories'}]${subtopicLine ? `\n${subtopicLine}` : ''}\n${storyList}`
  }).join('\n\n---\n\n')

  const recentTitlesBlock = recentTitles.length > 0
    ? `Already sent to ${subscriber.first_name} in the last 2 days — do NOT cover these same events or ongoing sagas again today:\n${recentTitles.map(t => `- ${t}`).join('\n')}\n`
    : ''

  const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const subscriberTopics = topicStories.map(t => t.topic)
  const hasSports = subscriberTopics.some(t => t === 'Sports' || ['NFL','NBA','MLB','NHL','College Football','College Basketball','Soccer / MLS','Golf'].includes(t))

  return `You are the editor of Morning Memo, a warm, intelligent daily briefing written for an older audience.
Write a personalized newsletter for ${subscriber.first_name}.
Today's date: ${todayStr}
This subscriber's topics: ${subscriberTopics.join(', ')}

${hasSports ? `⚠ HARD RULE — SPORTS CONTAINMENT: This subscriber has a Sports panel. Sports stories (games, scores, trades, athletes, leagues, tournaments) are ONLY permitted inside the Sports panel. They are strictly forbidden in World News, Politics, Finance, or any other panel. A baseball game result is not World News. A trade is not Finance. A tournament bracket is not Politics. If a story is about a sport, it goes in Sports or gets skipped — no exceptions.\n` : `⚠ HARD RULE — NO SPORTS: This subscriber did NOT select Sports. Do not include any sports stories, game results, trades, athlete news, or league updates in any panel.\n`}
${subscriber.city ? `Their city: ${subscriber.city}` : ''}
${subscriber.extra_notes ? `Personal note from subscriber: "${subscriber.extra_notes}"` : ''}
${recentTitlesBlock}
Today's stories, organized by topic:
${topicBlocks}

Format your response using EXACTLY these markers — do not deviate:

[GREETING]
Two sentences. The first greets ${subscriber.first_name} by name — warm and energizing, no weather references. The second is a punchy teaser that previews 2-3 of the actual stories appearing below — like a friend giving you a quick heads-up on what's in today's memo. Only reference stories that genuinely appear in today's newsletter. Never invent or allude to content that isn't there.
  WRONG: "The Devils are in trouble tonight." — if there is no Devils story below, do not say this.
  RIGHT: "The Senators pulled off a stunner, markets are jittery ahead of the Fed decision, and there's a wild story out of Italy you won't want to miss."

[TOPIC: TopicNameHere]
[HEADLINE]Headline text here[/HEADLINE]
2-3 sentence summary in plain, clear English. Hard limit: 3 sentences maximum. No exceptions.
[LINK]paste-the-original-link-url-here[/LINK]

[HEADLINE]Second headline here[/HEADLINE]
2-3 sentence summary. Hard limit: 3 sentences maximum. No exceptions.
[LINK]paste-the-original-link-url-here[/LINK]

(repeat [TOPIC: ...] blocks for each topic)

═══ STRUCTURE RULES ═══
- Use the exact markers: [GREETING], [TOPIC: X], [HEADLINE], [/HEADLINE], [LINK], [/LINK], [QUOTE]
- [TOPIC: X] must use the exact topic name from the prompt. Never use a subtopic or story title as the topic name.
- After each story summary, copy the original Link URL into [LINK]...[/LINK]. Omit the marker if no link was provided.
- When a topic lists the subscriber's specific interests, prioritize those angles — make the subscriber feel this was written just for them.
- Each topic block is labeled [Write exactly N stories]. Write exactly that many — no more, no fewer. No single subtopic may account for more than 2.
- All stories for a topic go under one single [TOPIC: X] block — never split a topic into multiple blocks.
- The [QUOTE] section is mandatory and must ALWAYS appear at the end.

═══ VALUE RULE ═══
Every summary must leave the reader genuinely more informed than the headline alone did. Start one level deeper — explain why it matters, what the number is, what happens next. Never restate the headline. If the source is too thin to support a real 2-3 sentence summary, skip it and use a different story from the pool.
  WRONG: "The Fed raised interest rates again as inflation concerns persist."
  RIGHT: "The Fed's quarter-point hike brings the benchmark rate to 5.5%, its highest level since 2001 — aimed at cooling stubborn services inflation, but mortgage rates are expected to climb further in response."

Headlines must answer "what happened?" — not "what is this about?"
  WRONG: "Medicaid and the politics of health care and elections."
  RIGHT: "House Republicans Propose $880B Medicaid Cut Ahead of 2026 Midterms"

═══ CARDINAL RULE ═══
Every story panel must leave the reader genuinely more informed than the headline alone did. If someone reads only your summary and never clicks the link, they must still walk away knowing something real. A summary that merely restates the headline in different words has failed.

═══ LENGTH RULE ═══
Every story summary is capped at 3 sentences. Not 4. Not 5. 3.

═══ CONTENT RULES ═══
- SOURCE ACCURACY: Every fact in your summary — statistics, scores, records, dates, names, positions, roster moves, poll percentages, transactions — must come directly from the source provided. Never add supporting facts from your own training data. If the source does not state it, you do not state it. For any story, answer the Who, What, Where, When that the source provides — a summary missing a named person, location, or key figure when the source includes one is not acceptable. For roster/cap/transaction stories, you must name the specific move (who was traded, released, or restructured) — if the source doesn't identify it, skip the story.
  WRONG: "Only Wilt Chamberlain (100 points in 1962) and Kobe Bryant (81 points in 2006) have scored more." — if the source doesn't say this, don't write it.
  WRONG: "The Green Bay Packers gained cap flexibility heading into free agency." — name the specific transaction.
  RIGHT: "The Green Bay Packers freed up $12 million by releasing linebacker De'Vondre Campbell."

- NUMBERS: Always include the specific number when one exists in the source. Finance stories must include at least one figure (%, price, rate, or dollar amount). Poll/survey stories must state the exact percentage — never "a majority" or "most Americans." Sports records and streaks must state the specific count.
  WRONG: "Markets fell sharply amid recession fears." / "A majority of Americans oppose military action."
  RIGHT: "The S&P 500 dropped 1.8%." / "62% of Americans oppose military action, according to a new poll."

- NAMES & TITLES: Use a person's full name (first and last) on first reference — never last name only, never a vague description like "a veteran player" when the source names them. Use the title the source assigns — if the source says "President Trump," write "President Trump." Never prepend "former" unless the source states it. Spell out acronyms in full on first use: "Federal Reserve (Fed)."

- NO CLICKBAIT: State the answer directly. If the article names a vegetable, drug, person, decision, or outcome — write it. Never use "one vegetable," "a particular supplement," "makes a decision," or any phrasing that withholds the core fact.
  WRONG: "Kirk Cousins has made his retirement decision as the quarterback landscape shifts."
  RIGHT: "Kirk Cousins has announced his retirement, ending a 12-year NFL career."

- ONE STORY, ONE EVENT: Each entry covers exactly one event. Never combine unrelated stories into one headline or summary. Never cover the same event twice in the same newsletter — if two source articles cover the same game or development, pick the one with more substance and skip the other.
  WRONG: "USA advances in World Baseball Classic as tensions ease over Middle East ceasefire." — two unrelated events.
  WRONG: "Kirk Cousins retires as one surprise NFC contender emerges as a free-agent destination." — unrelated second story bolted on.

- THIN STORIES: If the source material is too thin to support a genuine 2–3 sentence summary — essentially just a headline reworded into one sentence — skip it entirely and use a different story from the pool. Never pad a stub into fake substance.

- NO REPEATS: If a story covers the same ongoing event, court case, or policy dispute as any story in the "Already sent" list above, skip it and use a different story from the pool.

- TOPIC PLACEMENT: A story belongs in a panel only if it is substantively about that topic — not merely adjacent, themed, or incidentally mentioned. Sports stories (games, scores, trades, athletes, leagues) belong exclusively in the Sports panel. If the subscriber has no Sports panel, skip sports stories entirely.
  WRONG: "Italy Stuns USA 8-6 in World Baseball Classic" placed in World News.
  WRONG: A celebrity wedding in the History panel because the venue was "medieval-themed."

- SPORTS: Do not open summaries with the sport name ("In NBA basketball..." or "NFL football saw...") — the panel header already says it. Always name both teams. Always include the final score for game recaps. Never say "the team" or "they" — use the team name. When covering a record or streak, state the specific number.
  WRONG: "Shai Gilgeous-Alexander tied a record set by Wilt Chamberlain over 60 years ago."
  RIGHT: "Shai Gilgeous-Alexander extended his streak of consecutive 20-point games to 53, tying Wilt Chamberlain's 1962 record."

- NAME THE FINDING: Any story covering a study, discovery, decision, treatment, outcome, or list must state the actual content. Never describe that information exists without giving it. This applies to every topic.
  WRONG: "Researchers found that ocean pressure supports marine life through mechanisms scientists did not previously understand."
  RIGHT: "Researchers found that deep-sea pressure drives chemosynthesis in piezophilic bacteria, sustaining ecosystems without sunlight."
  WRONG: "Good Housekeeping compiled a list of 100+ foods that form the foundation of the Mediterranean diet."
  RIGHT: "The Mediterranean diet centers on olive oil, fatty fish, legumes, nuts, and fresh vegetables — Good Housekeeping's guide breaks down 100+ specific options by category."

- FINANCE TIME AWARENESS: Be precise about market timing. If a story covers Friday's session, futures reference Monday's open — not "the open."
  WRONG: "The Dow dropped 700 points, with futures pointing to further weakness at the open."
  RIGHT: "The Dow dropped 700 points on Friday, with futures suggesting Monday's open could see further losses."

- WEATHER — FORWARD ONLY: The Local Weather panel covers only today and future days. Never reference any day that has already passed. Use today's date (provided above) to determine what is past.
  WRONG: "Tuesday looks mild" in a Wednesday morning newsletter.
  RIGHT: "Today is partly cloudy with a high of 45°F. Wednesday warms to 56°F."

- POLITICS: Present both sides or stick to facts only. Never editorialize or use loaded language without factual grounding.
  WRONG: "The controversial bill passed despite fierce opposition from those who called it an attack on working families."
  RIGHT: "The bill passed 52-48. Supporters say it reduces regulatory burdens; opponents argue it weakens environmental protections."

- OPINION LABELING: If the source is an opinion piece, editorial, or column rather than straight news, begin the headline with "Opinion:"

═══ TONE RULES ═══
- Warm, direct, and conversational — like a well-informed friend briefing you over coffee
- Written for an older audience — no internet slang, no pop culture references from the last 10 years
- Short sentences. Active voice. No filler.
- Never use the word "delve"
- Never use the phrases "it's worth noting," "importantly," or "it goes without saying"
- Plain text only — no markdown asterisks, no bullet points

`
}

// ----------------------------------------------------------------
// Parse Claude's structured response into sections
// ----------------------------------------------------------------
// Hard sentence cap — enforced in code regardless of what Claude wrote
// ----------------------------------------------------------------
function truncateToSentences(text, max = 3) {
  if (!text) return text
  const sentences = text.match(/[^.!?]*[.!?]+[\s]*/g)
  if (!sentences) return text
  return sentences.slice(0, max).join('').trim()
}

// ----------------------------------------------------------------
function parseNewsletterContent(text) {
  const result = { greeting: '', topics: [], quote: null }

  // Extract greeting
  const greetingMatch = text.match(/\[GREETING\]([\s\S]*?)(?=\[TOPIC:|$)/)
  if (greetingMatch) result.greeting = greetingMatch[1].trim()

  // Extract topics (everything between [TOPIC: X] and next [TOPIC:] or [QUOTE])
  const topicRegex = /\[TOPIC:\s*([^\]]+)\]([\s\S]*?)(?=\[TOPIC:|$|\[QUOTE\])/g
  let topicMatch
  while ((topicMatch = topicRegex.exec(text)) !== null) {
    const topicName = topicMatch[1].trim()
    const topicContent = topicMatch[2].trim()

    // Extract stories within this topic
    const stories = []
    const storyRegex = /\[HEADLINE\]([\s\S]*?)\[\/HEADLINE\]([\s\S]*?)(?=\[HEADLINE\]|$)/g
    let storyMatch
    while ((storyMatch = storyRegex.exec(topicContent)) !== null) {
      const rawBody = storyMatch[2].trim()
      if (rawBody) {
        const linkMatch = rawBody.match(/\[LINK\](https?:\/\/[^\s\[\]]+)/)
        const link = linkMatch ? linkMatch[1].trim() : ''
        const body = rawBody.replace(/\[LINK\][\s\S]*?(?:\[\/LINK\]|$)/, '').trim()
        stories.push({ headline: storyMatch[1].trim(), body: truncateToSentences(body), link })
      }
    }

    if (stories.length > 0) {
      result.topics.push({ name: topicName, stories })
    }
  }

  // Extract closing quote
  const quoteMatch = text.match(/\[QUOTE\]([\s\S]*)$/)
  if (quoteMatch) {
    const quoteContent = quoteMatch[1].trim()
    const lines = quoteContent.split('\n').map(l => l.trim()).filter(Boolean)
    const quoteLine = lines[0] || ''
    const attrLine = lines[1] || ''
    result.quote = {
      text: quoteLine.replace(/^[""\u201c]|[""\u201d]$/g, '').trim(),
      attribution: attrLine.replace(/^—\s*/, '').trim()
    }
  }

  return result
}

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
// Build Mission Control terminal email HTML
// ----------------------------------------------------------------
const TOPIC_EMOJIS = {
  'Sports': '⚽', 'NFL': '🏈', 'NBA': '🏀', 'MLB': '⚾', 'NHL': '🏒',
  'College Football': '🏈', 'College Basketball': '🏀', 'Soccer / MLS': '⚽', 'Golf': '⛳',
  'World News': '🌍', 'Politics': '🏛️', 'Finance': '📈', 'Technology': '💻',
  'Science': '🔬', 'Health': '🫀', 'Arts & Culture': '🎨', 'Food & Travel': '🍽️',
  'History': '🏛', 'Books & Ideas': '📚', 'Local Weather': '🌤️'
}

function buildMissionControlEmail(parsed, formattedDate, prefToken = null) {
  const mono = `'JetBrains Mono','IBM Plex Mono','Courier New',monospace`
  const sans = `'Space Grotesk','Segoe UI',Arial,sans-serif`

  // Build topic panel HTML — stories stacked vertically, full width
  const topicPanelsHtml = parsed.topics.map(({ name, stories }) => {
    const storyRows = stories.map((story, i) => {
      const borderTop = i > 0 ? 'border-top:1px solid rgba(255,255,255,0.06);' : ''
      const isWeatherLink = story.link && story.link.includes('wttr.in')
      const readMoreLink = story.link && !isWeatherLink
        ? `<p style="margin:8px 0 0;font-family:${mono};font-size:10px;letter-spacing:1.5px;"><a href="${esc(story.link)}" style="color:#00d4ff;text-decoration:none;text-transform:uppercase;">Go Deeper &rarr;</a></p>`
        : ''
      return `<tr>
        <td style="padding:16px 20px;${borderTop}">
          <p style="margin:0 0 8px;font-family:${mono};font-size:12px;font-weight:700;color:#dde2ed;letter-spacing:0.3px;line-height:1.4;">${esc(story.headline)}</p>
          <p style="margin:0;font-family:${sans};font-size:13px;line-height:1.75;color:#a8b8cc;font-weight:300;">${esc(story.body)}</p>
          ${readMoreLink}
        </td>
      </tr>`
    }).join('')

    return `
      <tr>
        <td style="padding:6px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid rgba(255,255,255,0.07);border-radius:2px;">
            <tr>
              <td style="background:rgba(0,212,255,0.05);border-bottom:1px solid rgba(0,212,255,0.15);padding:8px 18px;">
                <p style="margin:0;font-family:${mono};font-size:10px;letter-spacing:3px;color:#00d4ff;text-transform:uppercase;">${esc(name)}</p>
              </td>
            </tr>
            ${storyRows}
          </table>
        </td>
      </tr>`
  }).join('')

  // Build quote panel HTML
  const quotePanelHtml = parsed.quote ? `
    <tr>
      <td style="padding:6px 20px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-left:2px solid #00d4ff;">
          <tr>
            <td style="padding:12px 18px;">
              <p style="margin:0 0 4px;font-family:${mono};font-size:10px;letter-spacing:3px;color:#00d4ff;text-transform:uppercase;">Today's Quote</p>
              <p style="margin:10px 0 0;font-family:${sans};font-size:14px;line-height:1.75;color:#dde2ed;font-style:italic;font-weight:300;">&ldquo;${esc(parsed.quote.text)}&rdquo;</p>
              <p style="margin:8px 0 0;font-family:${mono};font-size:11px;color:#6b7fa0;letter-spacing:1px;">&mdash; ${esc(parsed.quote.attribution)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>` : ''

  // Split "Good morning, Name." from the rest so we can color it separately
  const greetingRaw = parsed.greeting
  const greetingMatch = greetingRaw.match(/^(Good\s+morning[,\s]+[^.!?]+[.!?]?\s*)/i)
  const greetingBlue = greetingMatch ? greetingMatch[1].trimEnd() : ''
  const greetingRest = greetingMatch ? greetingRaw.slice(greetingBlue.length) : greetingRaw

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Morning Memo</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@300;400;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#0d1524;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1524;padding:32px 12px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;background:#111827;border:1px solid rgba(255,255,255,0.07);">

          <!-- ── MASTHEAD ── -->
          <tr>
            <td align="center" style="padding:28px 20px 22px;border-bottom:1px solid rgba(255,255,255,0.08);">
              <p style="margin:0;font-family:${mono};font-size:22px;font-weight:700;color:#dde2ed;letter-spacing:0.05em;">Morning<span style="color:#00d4ff;">Memo</span></p>
              <p style="margin:8px 0 0;font-family:${mono};font-size:10px;letter-spacing:3px;color:#6b7fa0;text-transform:uppercase;">${esc(formattedDate)}</p>
            </td>
          </tr>

          <!-- ── GREETING ── -->
          <tr>
            <td style="padding:20px 20px 12px;">
              <p style="margin:0;font-family:${sans};font-size:14px;line-height:1.75;color:#a8b8cc;font-weight:300;"><font color="#00d4ff"><span style="color:#00d4ff;">${esc(greetingBlue)}</span></font>${esc(greetingRest)}</p>
            </td>
          </tr>

          <!-- ── DIVIDER ── -->
          <tr>
            <td style="padding:0 20px 6px;">
              <div style="height:1px;background:rgba(255,255,255,0.06);"></div>
            </td>
          </tr>

          <!-- ── TOPIC PANELS ── -->
          ${topicPanelsHtml}

          <!-- ── QUOTE ── -->
          ${quotePanelHtml}

          <!-- ── FOOTER ── -->
          <tr>
            <td style="border-top:1px solid rgba(255,255,255,0.06);padding:20px;text-align:center;">
              <p style="margin:0 0 8px;font-family:${mono};font-size:11px;font-weight:700;color:#dde2ed;letter-spacing:0.05em;">Morning<span style="color:#00d4ff;">Memo</span></p>
              <p style="margin:0 0 12px;font-family:${sans};font-size:12px;color:#6b7fa0;line-height:1.6;">
                You're receiving this because you subscribed to Morning Memo.
              </p>
              ${prefToken ? `
              <a href="${process.env.APP_URL || 'http://localhost:3001'}/preferences.html?token=${prefToken}" style="font-family:${mono};font-size:10px;letter-spacing:2px;color:#00d4ff;text-decoration:underline;text-transform:uppercase;"><span style="color:#00d4ff;">Update Preferences</span></a>
              &nbsp;&nbsp;&middot;&nbsp;&nbsp;
              <a href="${process.env.APP_URL || 'http://localhost:3001'}/unsubscribe.html?token=${prefToken}" style="font-family:${mono};font-size:10px;letter-spacing:2px;color:#a8b8cc;text-decoration:underline;text-transform:uppercase;"><span style="color:#a8b8cc;">Unsubscribe</span></a>
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
// Retry helper (exponential backoff)
// ----------------------------------------------------------------
async function fetchWithRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i === retries - 1) throw e
      const delay = 1000 * Math.pow(2, i)
      logger.warn(`[RETRY] Claude attempt ${i + 1} failed, retrying in ${delay}ms`, e.message)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

// ----------------------------------------------------------------
// Main export: generate a newsletter for one subscriber
//
// topicStories: array of { topic, stories[] } from fetch-rss.js
// Returns: { subject, body_html }
// ----------------------------------------------------------------
async function generateNewsletter(subscriber, topicStories, recentTitles = [], recentQuotes = []) {
  if (!topicStories || topicStories.length === 0) {
    throw new Error(`No stories available for subscriber ${subscriber.id} — cannot generate newsletter`)
  }

  const quoteStyle = resolveQuoteStyle(subscriber.quote_style)
  const allocation = calculateStoryAllocation(subscriber, topicStories)
  const cappedTopicStories = topicStories.slice(0, Object.keys(allocation).length)
  const prompt = buildPrompt(subscriber, cappedTopicStories, allocation, recentTitles)

  const rawText = await fetchWithRetry(async () => {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }]
    })
    return message.content[0].text
  })

  const parsed = parseNewsletterContent(rawText)

  // Re-merge any panels Claude incorrectly named after a subtopic instead of the parent topic.
  // Build subtopic → parent lookup from subscriber preferences, then remap parsed topic names.
  const validTopicNames = new Set(topicStories.map(t => t.topic))
  const subtopicToParent = {}
  for (const { topic } of topicStories) {
    for (const sub of (subscriber.preferences?.[topic] || [])) {
      subtopicToParent[sub.toLowerCase()] = topic
    }
  }
  const mergedTopicMap = {}
  for (const parsedTopic of parsed.topics) {
    const parent = validTopicNames.has(parsedTopic.name)
      ? parsedTopic.name
      : (subtopicToParent[parsedTopic.name.toLowerCase()] || parsedTopic.name)
    if (!mergedTopicMap[parent]) mergedTopicMap[parent] = { name: parent, stories: [] }
    mergedTopicMap[parent].stories.push(...parsedTopic.stories)
  }
  // Restore the shuffled input order — Claude may reorder topics in its output
  const inputOrder = topicStories.map(t => t.topic.toLowerCase())
  parsed.topics = Object.values(mergedTopicMap).sort((a, b) => {
    const ai = inputOrder.indexOf(a.name.toLowerCase())
    const bi = inputOrder.indexOf(b.name.toLowerCase())
    const aPos = ai === -1 ? 999 : ai
    const bPos = bi === -1 ? 999 : bi
    return aPos - bPos
  })

  // Hard-cap every topic to its allocated story count regardless of what Claude wrote.
  // Use case-insensitive lookup so minor name variations (e.g. "Health" vs "Health & Wellness")
  // don't silently fall through to the || 1 floor.
  const allocationLower = Object.fromEntries(
    Object.entries(allocation).map(([k, v]) => [k.toLowerCase(), v])
  )
  parsed.topics = parsed.topics.map(t => ({ ...t, stories: t.stories.slice(0, allocationLower[t.name.toLowerCase()] || 1) }))

  // Recover original RSS links by matching Claude's written headlines back to source articles.
  // Claude frequently mangles URLs when copying — source links are always valid.
  // Each parsed story is matched to the source article with the highest headline word overlap.
  const sourceByTopicLower = {}
  for (const { topic, stories: srcStories } of topicStories) {
    sourceByTopicLower[topic.toLowerCase()] = srcStories
  }
  const wordOverlap = (a, b) => {
    const words = s => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 3))
    const wa = words(a), wb = words(b)
    let n = 0; for (const w of wa) if (wb.has(w)) n++; return n
  }
  for (const parsedTopic of parsed.topics) {
    const sources = sourceByTopicLower[parsedTopic.name.toLowerCase()] || []
    const usedIdx = new Set()
    for (const story of parsedTopic.stories) {
      let bestIdx = -1, bestScore = -1
      for (let i = 0; i < sources.length; i++) {
        if (usedIdx.has(i)) continue
        const score = wordOverlap(story.headline, sources[i].title || '')
        if (score > bestScore) { bestScore = score; bestIdx = i }
      }
      if (bestIdx >= 0 && sources[bestIdx].link) {
        story.link = sources[bestIdx].link
        usedIdx.add(bestIdx)
      }
    }
  }

  // Drop stories with no link (every rendered story must have a working Go Deeper)
  // and drop any topic panel that ends up empty as a result
  parsed.topics = parsed.topics
    .map(t => ({ ...t, stories: t.stories.filter(s => s.link) }))
    .filter(t => t.stories.length > 0)

  // Quote is picked entirely in code — no Claude involvement, full dedup guarantee
  parsed.quote = pickQuote(quoteStyle, recentQuotes)

  // Fallback: if parsing found no topics, log and use raw text in a single panel
  if (parsed.topics.length === 0) {
    logger.warn(`Newsletter parsing found no topic sections for ${subscriber.email} — using raw fallback`)
    parsed.topics = [{ name: 'Today\'s Briefing', stories: [{ headline: 'Your Morning Summary', body: rawText }] }]
  }

  const now = new Date()
  const formattedDate = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })

  const subject = `Your Morning Memo — ${formattedDate}`
  const body_html = buildMissionControlEmail(parsed, formattedDate, subscriber.pref_token)

  // Build link → original RSS title map so we store the raw title for deduplication,
  // not Claude's rewritten headline (which never matches the RSS feed title on the next run)
  const originalTitleByLink = {}
  for (const { stories } of topicStories) {
    for (const s of stories) {
      if (s.link && s.title) originalTitleByLink[s.link] = s.title
    }
  }

  // Collect all sent stories (link + original RSS title) for deduplication
  const sentStories = parsed.topics
    .flatMap(t => t.stories.map(s => ({ link: s.link, title: originalTitleByLink[s.link] || s.headline })))
    .filter(s => s.link)

  const quoteAttribution = parsed.quote?.attribution || null
  const quoteText = parsed.quote?.text || null

  return { subject, body_html, sentStories, quoteAttribution, quoteText }
}

// ----------------------------------------------------------------
// Exports
// ----------------------------------------------------------------
module.exports = { generateNewsletter, buildMissionControlEmail, parseNewsletterContent }
