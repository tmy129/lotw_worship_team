-- Vote periods name a year as well as a month.
--
-- months held bare month numbers (1-12) and every query matched them with
-- extract(month ...), so a vote for 12月 + 1月 opened in late 2026 also pulled in
-- January 2026's weeks: there was no way to say "January 2027". Each entry is now
-- a 'YYYY-MM' string, matched against to_char(week_id, 'YYYY-MM').
--
-- Existing rows carry no year, so it is inferred from when the vote was opened:
-- a month up to two before the opening month is taken as this year (a vote opened
-- a little late), anything earlier as next year (a vote opened ahead of the new
-- year). ALTER ... TYPE cannot run a subquery, hence the add / fill / swap.
alter table worship_vote_settings add column months_ym text[] not null default '{}';

update worship_vote_settings s
   set months_ym = coalesce((
     select array_agg(
              to_char(make_date(
                extract(year from base)::int
                  + case when m < extract(month from base)::int - 2 then 1 else 0 end,
                m, 1), 'YYYY-MM')
              order by extract(year from base)::int
                         + case when m < extract(month from base)::int - 2 then 1 else 0 end,
                       m)
       from unnest(s.months) as m,
            lateral (select coalesce(s.opened_at::date, s.deadline, current_date) as base) b
   ), '{}');

alter table worship_vote_settings drop column months;
alter table worship_vote_settings rename column months_ym to months;
