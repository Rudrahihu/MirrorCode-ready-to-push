# Style Mimic Tool — Phase 1

Learns your personal coding style from a code sample and outputs a structured
"style fingerprint." This is the first building block toward a full tool that
generates/completes code matching your style.

## Setup

```bash
npm install
cp .env.example .env
```

Get a free key from at least one of these, then paste it into `.env`:

- **Groq** (recommended, fastest): https://console.groq.com/keys — free, no card
- **Gemini**: https://aistudio.google.com/apikey — free, no card
- **OpenRouter**: https://openrouter.ai/keys — free `:free` model variants

You only need ONE key to get started. The backend falls back to the next
provider automatically if one is rate-limited or fails.

## Run

```bash
npm start
```

Open http://localhost:3001 — paste some of your own code, click "Analyze
style," and you'll get back a JSON style fingerprint.

## What's next (not built yet)

- **Phase 2**: take a fingerprint + a task ("build a calculator") and
  generate new code matching it
- **Phase 3**: paste an in-progress file and have it completed in your style
- **Phase 4**: pull a GitHub repo automatically instead of pasting code
- **BYOK**: the backend already supports a `byok` field in the `/api/profile`
  request body (`{ code, byok: { baseURL, apiKey, model } }`) if a user wants
  to use their own key instead of the shared free-tier ones — the frontend
  just doesn't have a UI for it yet.

## Known limitations

Tested across JavaScript, Python, Go, Rust, Java, and Ruby samples. The
profiler is reliable on naming conventions, control flow, and error-handling
patterns, which generalize well across languages. It's weaker on
language-specific idioms that are easy to skim past:

- **Closures / expression-based returns** (e.g. Rust's `.map(|i| ...)`,
  implicit last-expression returns) sometimes get flattened into generic
  "declaration" style instead of being called out.
- **Symbols and metaprogramming-flavored constructs** (e.g. Ruby's
  `{ key: value }` symbol hashes, `attr_reader`) are sometimes missed
  entirely rather than flagged as a notable quirk.
- Quote-type counting (`formatting.quotes`) is usually right on the
  majority call but the exact counts can be slightly off — the `evidence`
  field exists specifically so this is checkable rather than silently
  wrong.

None of this blocks Phase 1's purpose (producing a usable style
fingerprint), but it's worth knowing before leaning on the fingerprint
heavily in Phase 2 generation.

## Notes

- Free tier limits change without much notice — if Groq feels slow to
  respond or errors out, check your key/quota at console.groq.com first.
- The profiling prompt lives in `PROFILE_SYSTEM_PROMPT` in `server.js` —
  this is the part most worth iterating on for quality.
