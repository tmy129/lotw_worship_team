import type { Env } from "../index";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const DEFAULT_TPM_BUDGET = 8000;

// Measured on the Chinese-heavy scheduling prompts this app sends: roughly 1.6
// characters per token. Deliberately slightly optimistic about size so the
// reservation errs small.
const CHARS_PER_TOKEN = 1.6;
const RESERVE = 200;

/**
 * Forwards a scheduling prompt to Groq and returns the plan text.
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
  const estPromptTokens = Math.ceil(prompt.length / CHARS_PER_TOKEN);
  const maxOutput = Math.max(1024, Math.min(8192, tpmBudget - estPromptTokens - RESERVE));

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      // gpt-oss is a reasoning model: reasoning tokens come out of the same
      // budget, and the chain of thought is not wanted in the response.
      max_completion_tokens: maxOutput,
      reasoning_effort: "low",
      include_reasoning: false,
      temperature: 0.3,
    }),
  });

  const text = await response.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Groq returned non-JSON (HTTP ${response.status}): ${text.slice(0, 300)}`);
  }
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
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
