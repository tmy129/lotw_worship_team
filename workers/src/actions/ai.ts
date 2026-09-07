import type { Env } from "../index";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const DEFAULT_TPM_BUDGET = 8000;

// Measured on the Chinese-heavy scheduling prompts this app sends: roughly 1.6
// characters per token. Deliberately slightly optimistic about size so the
// reservation errs small.
const CHARS_PER_TOKEN = 1.6;
const RESERVE = 200;
/** Mirrors RESERVE_FOR_ANSWER in src/lib/prompt.js, which the budget script measures. */
const RESERVE_FOR_ANSWER = 2000;

/**
 * The shape a plan must come back in.
 *
 * Roles and dates are enumerated from what the caller asked for, so the model
 * cannot invent a role the roster has nobody for, or answer for a week that was
 * not requested. Assignments are a list of role-and-members pairs rather than
 * fixed keys because the role vocabulary comes from the church record and is not
 * known here.
 */
function planSchema(weeks: string[], roles: string[]) {
  const object = (properties: Record<string, unknown>) => ({
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  });
  return object({
    weeks: {
      type: "array",
      items: object({
        date: { type: "string", enum: weeks },
        assignments: {
          type: "array",
          items: object({
            role: { type: "string", enum: roles },
            members: { type: "array", items: { type: "string" } },
          }),
        },
      }),
    },
  });
}

/**
 * Forwards a scheduling prompt to Groq and returns the plan.
 *
 * Groq counts the prompt and the reserved output together against the
 * per-minute token limit, so the output budget has to be derived from the
 * prompt rather than fixed — a constant reservation is rejected outright on a
 * long prompt. Every failure surfaces with the upstream message: an empty
 * completion used to read as success and produce an empty schedule.
 */
export async function runAISchedule(params: Record<string, unknown>, env: Env): Promise<string> {
  if (!env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not configured");
  const model = env.GROQ_MODEL || DEFAULT_MODEL;
  const tpmBudget = Number(env.GROQ_TPM_BUDGET || DEFAULT_TPM_BUDGET);

  const prompt = String(params.prompt ?? "");
  if (!prompt.trim()) throw new Error("prompt is required");

  // A caller that names the weeks and roles gets a schema-enforced answer. One
  // that does not — an old browser tab, say — still gets the free text it
  // expects, so a stale client degrades rather than breaks.
  const weeks = Array.isArray(params.weeks) ? params.weeks.map(String) : [];
  const roles = Array.isArray(params.roles) ? params.roles.map(String) : [];
  const structured = weeks.length > 0 && roles.length > 0;
  // Faults from a rejected attempt are appended to the same prompt rather than
  // sent as a follow-up turn. Handing the model its own answer back invited it
  // to patch a few weeks and return only those, and resending that answer cost
  // more tokens than the request itself.
  const problems = Array.isArray(params.problems) ? params.problems.map(String) : [];
  const userMessage = problems.length
    ? `${prompt}\n\n上一次的安排有以下問題，請避開這些錯誤重新安排全部週次：\n${problems.map(p => `- ${p}`).join("\n")}`
    : prompt;

  const estPromptTokens = Math.ceil(userMessage.length / CHARS_PER_TOKEN);
  // A request covers one calendar month — five weeks at most — and a month's
  // answer measures around 900 tokens. 1800 leaves room for a longer month and
  // for the model's reasoning, while still letting a call and its correction
  // both fit inside the per-minute budget.
  const needed = weeks.length ? 1800 : RESERVE_FOR_ANSWER;
  const maxOutput = Math.max(1024, Math.min(needed, tpmBudget - estPromptTokens - RESERVE));

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: userMessage }],
      // gpt-oss is a reasoning model: reasoning tokens come out of the same
      // budget, and the chain of thought is not wanted in the response.
      max_completion_tokens: maxOutput,
      // Low is not a budget compromise but the only setting that answers: at
      // medium this model spends more reasoning on a nine-week plan than the
      // whole per-minute budget can buy — 2998 of 3000 tokens, and nothing
      // emitted — while at low it reasons for 22 and answers in about 1500.
      reasoning_effort: "low",
      include_reasoning: false,
      temperature: 0.3,
      ...(structured
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: "worship_schedule", strict: true, schema: planSchema(weeks, roles) },
            },
          }
        : {}),
    }),
  });

  const text = await response.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Groq returned non-JSON (HTTP ${response.status}): ${text.slice(0, 300)}`);
  }
  if (data.error) {
    // When a structured answer fails validation the upstream message says only
    // that it did; failed_generation is the part that says why, so it travels
    // with the error instead of being dropped.
    const detail = data.error.failed_generation
      ? ` — 模型產出：${String(data.error.failed_generation).slice(0, 400)}`
      : "";
    throw new Error((data.error.message || JSON.stringify(data.error)) + detail);
  }
  if (!response.ok) throw new Error(`Groq HTTP ${response.status}: ${text.slice(0, 300)}`);

  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? "";
  if (!content.trim()) {
    throw new Error(
      `AI returned no content (model: ${model}, finish_reason: ${choice?.finish_reason ?? "unknown"}, output budget: ${maxOutput})`,
    );
  }
  return content;
}
