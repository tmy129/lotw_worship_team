// Applies a .sql file, or a statement given on stdin, to a Neon database.
//
//   BRANCH_DATABASE_URL=... node scripts/run-sql.mjs workers/migrations/0001_init.sql
//   BRANCH_DATABASE_URL=... echo "select 1" | node scripts/run-sql.mjs -
//
// The HTTP driver runs one statement per call, so the file is split on
// semicolons that end a line — enough for plain DDL, which is all we ship.
// Exits non-zero on the first failure, printing the statement that failed.

import { neon } from "@neondatabase/serverless";
import fs from "node:fs";

const url = process.env.BRANCH_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) { console.error("Set BRANCH_DATABASE_URL (or DATABASE_URL)."); process.exit(1); }

const source = process.argv[2];
if (!source) { console.error("Usage: node scripts/run-sql.mjs <file.sql|->"); process.exit(1); }

const text = source === "-"
  ? fs.readFileSync(0, "utf8")
  : fs.readFileSync(source, "utf8");

const statements = text
  .split("\n")
  .filter(l => !l.trim().startsWith("--"))
  .join("\n")
  .split(/;\s*(?:\n|$)/)
  .map(s => s.trim())
  .filter(Boolean);

const sql = neon(url);
for (const [i, statement] of statements.entries()) {
  try {
    const rows = await sql.query(statement);
    const head = statement.split("\n")[0].slice(0, 60);
    if (Array.isArray(rows) && rows.length && !/^(create|alter|drop|insert|update|delete)/i.test(statement)) {
      console.log(`[${i + 1}] ${head}`);
      console.table(rows);
    } else {
      console.log(`[${i + 1}] ok  ${head}`);
    }
  } catch (e) {
    console.error(`\n[${i + 1}] FAILED: ${statement}\n  ${e.message}`);
    process.exit(1);
  }
}
