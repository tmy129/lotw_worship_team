-- Teams whose members receive the weekly song announcement.
--
-- 影音組 serve every service but belong to no 敬拜部 position, so they never
-- appear in a week's schedule and were never addressed by the announcement.
-- The audience is held here rather than as a list of people: the requirement is
-- about a role in the service, not about the two people currently filling it, so
-- membership is still read from the management system at send time.
--
-- The reference is the team's id, not its name, so renaming a team in the
-- management system cannot silently empty the audience.
create table worship_song_audience_teams (
  team_id  uuid primary key references teams(id) on delete cascade,
  added_at timestamptz not null default now()
);

-- Seeded with the team the requirement named. Adding another is one insert;
-- there is deliberately no user interface for a table that changes this rarely.
insert into worship_song_audience_teams (team_id)
select id from teams where name = '影音組'
on conflict (team_id) do nothing;
