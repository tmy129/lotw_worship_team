import { Client } from "pg";
import type { Env } from "./index";

/**
 * One connection per request, pooled by Hyperdrive rather than by us — the
 * documented pattern for Workers, which have no long-lived process to hold a
 * pool in.
 */
export async function withDb<T>(env: Env, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * The roster join: a member is a person with an active 敬拜部 membership, their
 * instruments are that team's positions they hold, and the worship-only columns
 * come from tables this application owns. Written once and used by both the
 * roster action and the health check, so a breaking change upstream surfaces in
 * the health check rather than on a Saturday morning.
 */
export const ROSTER_QUERY = `
  select p.id,
         p.name,
         p.email,
         coalesce(
           array_agg(tp.name order by tp.name) filter (where tp.name is not null),
           '{}'
         ) as instruments,
         mp.display_name,
         mp.app_role,
         mp.constraints,
         mp.av_color,
         mp.initials,
         li.line_user_id
    from team_members tm
    join teams t   on t.id = tm.team_id and t.name = '敬拜部'
    join persons p on p.id = tm.person_id
    left join team_member_positions tmp on tmp.team_member_id = tm.id
    left join team_positions tp         on tp.id = tmp.position_id
    left join worship_member_profiles mp on mp.person_id = p.id
    left join worship_line_identities li on li.person_id = p.id
   where tm.active and p.active
   group by p.id, p.name, p.email, mp.display_name, mp.app_role, mp.constraints,
            mp.av_color, mp.initials, li.line_user_id
   order by p.name
`;

/** The roster join narrowed to one person, for actions that return the row they just wrote. */
export const ROSTER_QUERY_BY_PERSON = ROSTER_QUERY.replace(
  "where tm.active and p.active",
  "where tm.active and p.active and p.id = $1",
);
