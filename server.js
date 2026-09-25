require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

// ---------------------------------------------------------------------------
// Provider fallback chain
// Groq -> Gemini (OpenAI-compatible endpoint) -> OpenRouter free model
// All three speak the OpenAI SDK protocol, so this is just base URL + key
// swapping, not three separate integrations.
// ---------------------------------------------------------------------------
const providers = [
  {
    name: 'groq',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY,
    model: 'openai/gpt-oss-20b',
  },
  {
    name: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
  },
  {
    name: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    model: 'meta-llama/llama-3.3-70b-instruct:free',
  },
];

// If the request carries a user-supplied key (BYOK), use ONLY that —
// don't fall through to shared free-tier keys for a user who brought their own.
function resolveProviders(byok) {
  if (byok && byok.apiKey && byok.baseURL) {
    return [{ name: 'byok', baseURL: byok.baseURL, apiKey: byok.apiKey, model: byok.model || 'default' }];
  }
  return providers.filter((p) => p.apiKey); // skip providers with no key configured
}

async function callWithFallback(messages, byok) {
  const chain = resolveProviders(byok);
  if (chain.length === 0) {
    throw new Error('No provider configured. Set GROQ_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY in .env, or send a byok key from the client.');
  }

  let lastErr;
  for (const p of chain) {
    try {
      const client = new OpenAI({ baseURL: p.baseURL, apiKey: p.apiKey });
      const completion = await client.chat.completions.create({
        model: p.model,
        messages,
        temperature: 0.1,
      });
      return { text: completion.choices[0].message.content, providerUsed: p.name };
    } catch (err) {
      lastErr = err;
      const status = err.status || err.response?.status;
      // Rate-limited or provider-side failure -> try the next one.
      // Anything else (bad request, auth) -> surface it immediately.
      if (status === 429 || (status && status >= 500)) continue;
      throw err;
    }
  }
  throw lastErr || new Error('All providers exhausted');
}

// ---------------------------------------------------------------------------
// Phase 1: Style Profiler
// POST /api/profile  { code: string, byok?: {baseURL, apiKey, model} }
// Returns a structured JSON "style fingerprint"
// ---------------------------------------------------------------------------
const PROFILE_SYSTEM_PROMPT = `You are a senior code reviewer analyzing a developer's personal coding style.
Given a code sample, extract their style as STRICT JSON only — no markdown fences, no prose before or after.

Before writing the JSON, mentally scan the sample line by line. Do not rely on
general conventions for the detected language (e.g. "JS commonly uses double
quotes") — every field must reflect what is literally present in THIS sample,
even if that's unusual. If a field type has multiple forms in the sample,
count actual occurrences and report the majority, or "mixed" with the split
if it's close (e.g. "mostly single, one template literal for interpolation").

Return this exact shape:
{
  "language": "detected language",
  "naming": {
    "variables": "camelCase | snake_case | mixed, with examples",
    "booleans": "pattern used, e.g. isX/hasX, with examples",
    "functions": "pattern + examples"
  },
  "formatting": {
    "indentation": "spaces or tabs, and width",
    "quotes": "count single-quote, double-quote, and template-literal (backtick) strings separately, then report which is actually most frequent — do not default to a language convention",
    "semicolons": "always | never | inconsistent"
  },
  "structure": {
    "functionStyle": "arrow vs declaration vs mixed",
    "controlFlow": "early returns vs nested ifs, ternary usage, etc.",
    "errorHandling": "try/catch habits, defensive checks"
  },
  "comments": {
    "density": "sparse | moderate | heavy",
    "tone": "what kind of things they comment on"
  },
  "notableQuirks": ["short list of anything distinctive"],
  "evidence": {
    "quotes": "one short literal line from the sample proving the quotes verdict above"
  }
}

Base every field on actual evidence in the code. If something can't be determined from the sample, say "not enough evidence" rather than guessing. Never state a stylistic default that isn't directly observable in the sample provided.`;

app.post('/api/profile', async (req, res) => {
  const { code, byok } = req.body;
  if (!code || typeof code !== 'string' || code.trim().length < 20) {
    return res.status(400).json({ error: 'Send at least a few lines of real code in `code`.' });
  }

  try {
    const { text, providerUsed } = await callWithFallback(
      [
        { role: 'system', content: PROFILE_SYSTEM_PROMPT },
        { role: 'user', content: code },
      ],
      byok
    );

    let profile;
    try {
      const cleaned = text.replace(/```json|```/g, '').trim();
      profile = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({ error: 'Model returned non-JSON output.', raw: text, providerUsed });
    }

    res.json({ profile, providerUsed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Profiling failed.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, providersConfigured: providers.filter((p) => p.apiKey).map((p) => p.name) });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`style-mimic-tool backend running on http://localhost:${PORT}`));
