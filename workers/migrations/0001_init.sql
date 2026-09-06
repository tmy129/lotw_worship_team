-- Worship scheduling tables.
--
-- These live in the same Neon database as the church management system so the
-- roster can be joined directly against its persons/teams tables. Every table
-- here is worship-owned and prefixed accordingly; management-owned tables are
-- read-only to this application and are referenced, never modified.

create table worship_weeks (
  id            date primary key,          -- the service date; no normalization needed
  label         text not null,
  practice_time text,
  service_time  text,
  status        text not null default 'upcoming'
);

create table worship_vote_settings (
  id        text primary key,
  months    smallint[] not null default '{}',
  deadline  date,
  opened_at timestamptz,
  opened_by text,
  status    text not null default 'open',
  note      text
);

create table worship_votes (
  week_id    date not null references worship_weeks(id) on delete cascade,
  person_id  uuid not null references persons(id) on delete cascade,
  vote       text not null check (vote in ('yes', 'no', 'maybe')),
  updated_at timestamptz not null default now(),
  primary key (week_id, person_id)          -- one vote per member per week
);

create table worship_schedule (
  id           uuid primary key default gen_random_uuid(),
  week_id      date not null references worship_weeks(id) on delete cascade,
  role         text not null,
  -- Seats within a role. 主領 and 配唱 take two people; every other role takes one.
  slot         smallint not null default 1,
  -- Null for 講員, who is recorded as free text and is often not a team member.
  person_id    uuid references persons(id) on delete cascade,
  member_name  text,
  updated_at   timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint worship_schedule_slot_range check (
    slot = 1 or (slot = 2 and role in ('主領', '配唱'))
  ),
  constraint worship_schedule_identity check (
    person_id is not null or member_name is not null
  )
);

-- Role cardinality: the seat is unique, so a single-person role cannot hold two
-- people and a two-person role cannot hold three.
create unique index worship_schedule_seat
  on worship_schedule (week_id, role, slot);

-- The same person cannot occupy both seats of 主領 or 配唱.
create unique index worship_schedule_person_once
  on worship_schedule (week_id, role, person_id)
  where person_id is not null;

create table worship_songs (
  week_id   date not null references worship_weeks(id) on delete cascade,
  slot      smallint not null check (slot >= 1),
  name      text not null,
  confirmed boolean not null default false,
  youtube   text,
  primary key (week_id, slot)
);

-- Worship-only attributes of a person. Name, email, instruments and active
-- status are NOT duplicated here — they are read from the management system.
create table worship_member_profiles (
  person_id   uuid primary key references persons(id) on delete cascade,
  app_role    text not null default 'member' check (app_role in ('admin', 'leader', 'member')),
  constraints text,
  av_color    text,
  initials    text
);
