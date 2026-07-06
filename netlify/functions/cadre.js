// Cadre proxy — forwards prompts to the Anthropic API with the server-side
// key so visitors never handle credentials. Guardrails: origin allowlist,
// hard-coded model, capped tokens and prompt size.

const ALLOWED_ORIGINS = [
  "https://dougfaulkner-del.github.io",
];
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1000;
const MAX_PROMPT_CHARS = 8000;

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export default async (req) => {
  const origin = req.headers.get("origin") || "";
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, cors);
  if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: "forbidden origin" }, 403, cors);

  let prompt;
  try {
    ({ prompt } = await req.json());
  } catch {
    return json({ error: "invalid JSON body" }, 400, cors);
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return json({ error: "prompt must be a non-empty string" }, 400, cors);
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return json({ error: `prompt exceeds ${MAX_PROMPT_CHARS} characters` }, 400, cors);
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: "proxy not configured" }, 503, cors);

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!upstream.ok) return json({ error: "upstream error " + upstream.status }, 502, cors);

  const d = await upstream.json();
  const text = (d.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return json({ text }, 200, cors);
};
