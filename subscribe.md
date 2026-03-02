# Blueprint: Handle New Subscriber

## Goal
Save a new subscriber's survey data to Supabase when they submit the onboarding form.

## Inputs Required
- name: string — subscriber's first name
- email: string — valid email address
- topics: string[] — selected topic names e.g. ["Sports", "Finance"]
- city: string | null — confirmed city if Local Weather selected
- tagAnswers: object — deep dive preferences keyed by question group
- time: string — delivery time e.g. "7:00am"
- quoteStyle: string — quote preference e.g. "Stoic"
- extra: string | null — optional freetext notes

## Scripts to Use
1. server.js POST /api/subscribe — validates and writes to Supabase

## Steps
1. Validate name, email, topics are present and email is valid format
2. Sanitize email (lowercase, trim)
3. Upsert to subscribers table (onConflict: email — re-subscribers update their prefs)
4. Return 200 + subscriber id on success
5. Return 400 for validation errors, 500 for DB errors

## Edge Cases
- Duplicate email: upsert updates preferences instead of erroring
- Local Weather selected but no city: frontend validates this before submit, but double-check city is present if 'Local Weather' is in topics
- Empty tagAnswers: fine — store as empty object {}

## Known Issues
- None yet
