-- The name the team calls each other by.
--
-- The church record holds a person's formal name (保秀貞) and optionally an
-- English one (Victoria Pao). The worship sheet recorded the short name the team
-- actually uses (Victoria, 世綸), which is what appears in the schedule grid, the
-- AI scheduling prompt and LINE messages. That is a worship-specific label, not
-- a correction to the church record, so it lives with the other worship-owned
-- attributes. When absent, the roster falls back to the person's formal name.

alter table worship_member_profiles add column display_name text;
