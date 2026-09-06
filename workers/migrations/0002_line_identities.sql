-- Worship's own LINE bindings.
--
-- LINE user identifiers are scoped to the provider that issued them. Worship
-- authenticates through channel 2009964527 and the management system through
-- 2007892040, and the same person carries a different identifier under each, so
-- the identifiers in the management system's identities table cannot be compared
-- with worship's and vice versa. The two id spaces stay separate; the person id
-- is what links a worship binding back to the church record, and is also what a
-- future change would use to unify the two.

create table worship_line_identities (
  person_id    uuid primary key references persons(id) on delete cascade,
  line_user_id text not null unique,
  display_name text,
  bound_at     timestamptz not null default now()
);
