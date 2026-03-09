-- Morning Memo — Supabase Database Schema
-- Run this in your Supabase project's SQL editor (Database > SQL Editor)

-- ============================================================
-- subscribers table
-- ============================================================
create table if not exists subscribers (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  first_name    text not null,
  email         text not null unique,
  topics        text[] not null default '{}',
  city          text,
  preferences   jsonb not null default '{}',
  delivery_time text not null,
  quote_style   text not null,
  extra_notes   text,
  active        boolean not null default true,
  last_sent_at  timestamptz,
  pref_token    text unique default gen_random_uuid()::text
);

-- Index for the cron job's time-slot lookups
create index if not exists idx_subscribers_delivery_time
  on subscribers (delivery_time)
  where active = true;

-- ============================================================
-- newsletters table
-- ============================================================
create table if not exists newsletters (
  id            uuid primary key default gen_random_uuid(),
  sent_at       timestamptz not null default now(),
  subscriber_id uuid not null references subscribers (id) on delete cascade,
  subject       text not null,
  body_html     text not null,
  delivery_time text not null,
  status        text not null check (status in ('sent', 'failed'))
);

-- Index for auditing newsletters by subscriber
create index if not exists idx_newsletters_subscriber_id
  on newsletters (subscriber_id);

-- ============================================================
-- sent_stories table
-- Tracks which story links + headlines were sent to each subscriber.
-- Used to deduplicate (skip stories already sent in last 2 days) and
-- to prevent repeat-saga coverage across consecutive days.
-- ============================================================
create table if not exists sent_stories (
  id            uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references subscribers (id) on delete cascade,
  story_link    text not null,
  title         text,
  sent_at       timestamptz not null default now()
);

-- Index for fast per-subscriber lookups by recency
create index if not exists idx_sent_stories_subscriber_sent
  on sent_stories (subscriber_id, sent_at);

-- ============================================================
-- Row Level Security
-- Enable RLS — the server uses the service key so it bypasses
-- RLS, but this blocks any accidental public access.
-- ============================================================
alter table subscribers enable row level security;
alter table newsletters enable row level security;
alter table sent_stories enable row level security;

-- No public policies — server-side service key only
