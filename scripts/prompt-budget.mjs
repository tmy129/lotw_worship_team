// Measures a scheduling prompt against the model's per-minute token budget.
//
//   node scripts/prompt-budget.mjs --months 10,11
//   node scripts/prompt-budget.mjs --months 10,11 --budget 8000
//
// Groq counts the prompt and the reserved completion together, so a prompt that
// grows quietly does not fail gradually — one day the whole request is rejected.
// This exits non-zero once the spare capacity falls below the threshold, so that
// day arrives in a terminal rather than on a Saturday morning.

import fs from "node:fs";
import {
  DEFAULT_TPM_BUDGET,
  OUTPUT_NEEDED_TOKENS,
  completionBudget,
  fillBatchPrompt,
} from "../src/lib/prompt.js";

const MIN_HEADROOM_TOKENS = 1500;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};

const months = String(arg("--months", "")).trim();
if (!months) {
  console.error("Usage: node scripts/prompt-budget.mjs --months 10,11 [--budget 8000]");
  process.exit(1);
}
const budget = Number(arg("--budget", DEFAULT_TPM_BUDGET));

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter(Boolean).map(l => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const call = async (action, params = {}) => {
  const qs = new URLSearchParams({ action, secret: env.VITE_APP_SECRET, ...params });
  const res = await (await fetch(`${env.VITE_GAS_URL}?${qs}`, { redirect: "follow" })).json();
  if (!res.ok) throw new Error(`${action}: ${res.error}`);
  return res.data;
};

const [members, weeks, summary] = await Promise.all([
  call("getMembers"),
  call("getWeeksByMonths", { months }),
  call("getVoteSummary", { months }),
]);
if (!weeks.length) { console.error(`No weeks in months ${months}`); process.exit(1); }

const weekRows = weeks.map(week => {
  const votes = summary.summary?.[week.id] ?? {};
  return { week, avail: members.filter(m => ["yes", "maybe"].includes(votes[m.id])) };
});

const prompt = fillBatchPrompt(weekRows, "");
const { prompt: promptTokens, output, spare } = completionBudget(prompt, budget);

console.log(`期間        ${months} — ${weekRows.length} 週`);
console.log(`prompt      ${prompt.length} 字元 → 估算 ${promptTokens} tokens`);
console.log(`每分鐘上限  ${budget} tokens`);
console.log(`預留給答案  ${output} tokens`);
console.log(`答案需要    ${OUTPUT_NEEDED_TOKENS} tokens`);
console.log(`可用餘裕    ${spare} tokens（門檻 ${MIN_HEADROOM_TOKENS}）`);

if (spare < MIN_HEADROOM_TOKENS) {
  console.error(`\n✗ 餘裕不足：prompt 需再縮 ${Math.ceil((MIN_HEADROOM_TOKENS - spare) * 1.6)} 字元左右。`);
  process.exit(1);
}
console.log("\n✓ 餘裕充足");
