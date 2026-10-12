// Minimal Gemini REST client. Deliberately no SDK dependency — this makes
// one JSON POST and needs nothing else.
//
// PRIVACY: callers send legal intake conversations through this. The PAID
// tier must be used; Google's own docs state free-tier content is "used to
// improve our products" while paid-tier content is not. A key on the free
// tier would quietly leak client intake content into training data.
const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
const BASE = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export async function generateJson(
  systemInstruction: string,
  userText: string,
  opts?: { model?: string; timeoutMs?: number },
): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "GEMINI_API_KEY not set" };
  const model = opts?.model ?? DEFAULT_MODEL;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 30_000);
  try {
    const res = await fetch(`${BASE}/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: {
          // Deterministic: the same conversation must not produce a
          // different rating between runs, or a dry run proves nothing
          // about what a real run would submit.
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, error: `${res.status} ${body.slice(0, 400)}` };
    const parsed = JSON.parse(body) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return { ok: false, error: `no text in response: ${body.slice(0, 300)}` };
    return { ok: true, text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export const GEMINI_MODEL = DEFAULT_MODEL;
