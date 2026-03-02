-- Morning Memo — Schema Update: Add preference token
-- Run this in your Supabase SQL Editor (one time only)

-- Add pref_token column — auto-generated UUID, unique per subscriber
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS pref_token uuid DEFAULT gen_random_uuid() UNIQUE;

-- Backfill any existing subscribers who don't have a token yet
UPDATE subscribers
  SET pref_token = gen_random_uuid()
  WHERE pref_token IS NULL;

-- Index for fast token lookups (preferences page)
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_pref_token
  ON subscribers (pref_token);
