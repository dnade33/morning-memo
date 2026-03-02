# Supabase Database Skill — Morning Memo

## Setup
- SUPABASE_URL — project URL from Settings > API
- SUPABASE_SERVICE_KEY — service role key (server only, NEVER expose to frontend)

## Client Setup (server-side only)
```javascript
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
```

## Error Handling — Always Do This
```javascript
const { data, error } = await supabase.from('subscribers').select()
if (error) {
  console.error('[DB ERROR]', error)
  throw new Error('Failed to fetch subscribers')
}
```

## Common Patterns for Morning Memo

### Insert new subscriber (upsert on email conflict)
```javascript
const { data, error } = await supabase
  .from('subscribers')
  .upsert({ first_name, email, topics, city, preferences, delivery_time, quote_style }, { onConflict: 'email' })
  .select()
  .single()
```

### Fetch subscribers by delivery time (cron job)
```javascript
const { data, error } = await supabase
  .from('subscribers')
  .select('*')
  .eq('active', true)
  .eq('delivery_time', '7:00am')
```

### Log a sent newsletter
```javascript
const { error } = await supabase
  .from('newsletters')
  .insert({ subscriber_id, subject, body_html, delivery_time, status: 'sent' })
```

### Update last_sent_at after sending
```javascript
const { error } = await supabase
  .from('subscribers')
  .update({ last_sent_at: new Date().toISOString() })
  .eq('id', subscriber_id)
```

## RLS Rules
- Enable RLS on both tables
- The API uses the service key server-side so RLS won't block it
- Never expose service key to the frontend HTML file

## Don'ts
- NEVER expose SUPABASE_SERVICE_KEY to morning-memo-combined.html
- NEVER skip error checking before using data
- NEVER disable RLS in production
