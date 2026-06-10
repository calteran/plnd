# Prompt Caching in the LLM Provider Layer

**Date:** 2026-06-10
**Issue:** [#869](https://github.com/calteran/plnd/issues/869)
**Status:** Design approved, pending implementation

## Problem

The agent provider layer (`plnd_agent/src/provider/`) sends `system` + `tools` on
every request with no prompt caching. Across an agentic run the static prefix
(system prompt + tool definitions) is byte-identical and re-sent on every loop
iteration; a full onboarding week-generation (`POST /agent/meal-plan`) is ~49
model calls, each re-billing the same prefix at full price.

`AnthropicUsage` (`anthropic.rs:118`) already *parses* `cache_read_input_tokens`
and `cache_creation_input_tokens` from responses, but folds neither into metrics
— the caching machinery is half-present and unobservable.

## Constraints (discovered, not assumptions)

1. **Opus-tier minimum cacheable prefix is 4096 tokens.** Our current static
   prefix (system + 8 tools) measures ~1,439 tokens — below the Opus floor. On
   the production capable model (`claude-opus-4-x`) caching silently does nothing
   (`cache_creation_input_tokens: 0`). Sonnet/Haiku minimum is 2048, so the dev
   tier (`claude-sonnet-4-6`) caches but prod does not.
2. **Concurrent fan-out defeats caching.** A cache entry is only readable after
   the first response is committed. The meal-plan fan-out (`fill_slots_parallel`,
   AIMD-gated, from #871) fires N identical-prefix calls simultaneously, so none
   can read what the others are still writing.
3. **Caching is a cost lever, not a rate-limit fix.** Cache reads do not solve
   the ITPM burst on their own.

## Decisions

| Question | Decision |
| --- | --- |
| Opus sub-4096 prefix | **Do not pad.** Plumb caching + metrics; it activates on Sonnet/Haiku now and on Opus automatically if the prefix grows naturally. Document that Opus does not qualify today. |
| Fan-out cache-warming | **Lean into the AIMD gate.** Start concurrency at 1 (slow-start) so the first call runs alone and warms the cache; let the existing gate ramp the rest. No bespoke warm-up call. |
| Slow-start ramp rate | **Exponential** (1 → 2 → 4 → … → max), doubling per clean completion until `max_limit` or the first rate-limit. |
| Anthropic cache breakpoint | **One breakpoint on the system block.** Render order is tools → system → messages, so a system breakpoint caches tools + system as one segment. No per-tool breakpoint. |
| Config flag | **None.** Always-on; a below-minimum prefix is billed normally with no downside. |

## Design

### 1. Anthropic request — `cache_control` on the system block

`AnthropicRequest.system` changes from `system: &'a str` to a structured array of
system text blocks, with a single `cache_control: {type: "ephemeral"}` breakpoint
on the last (only) block:

```jsonc
"system": [
  { "type": "text", "text": "<prompt>", "cache_control": { "type": "ephemeral" } }
]
```

Anthropic processes the request prefix in a fixed order — **tools → system →
messages** — independent of JSON key order. A breakpoint on the system block
therefore caches tools + system together as one segment. A second breakpoint on
the last tool would only add a separately-billed cache write for no gain when
system is also static, so it is omitted.

New private wire types in `anthropic.rs`:

```rust
#[derive(Serialize)]
struct AnthropicSystemBlock<'a> {
    #[serde(rename = "type")]
    kind: &'static str, // "text"
    text: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_control: Option<CacheControl>,
}

#[derive(Serialize, Clone, Copy)]
struct CacheControl {
    #[serde(rename = "type")]
    kind: &'static str, // "ephemeral"
}
```

`AnthropicRequest.system` becomes `Vec<AnthropicSystemBlock<'a>>` (one element,
carrying `cache_control: Some(ephemeral)`).

### 2. OpenAI-compat — response-side only

OpenAI-style prompt caching is **automatic** — there is no request field to set.
The "where supported" wiring is purely on the response: extend `OaiUsage` to parse
`prompt_tokens_details.cached_tokens` and map it to the provider-agnostic
cache-read field. Absent field → 0 (no-op for backends that do not report it).

```rust
#[derive(Deserialize, Default)]
struct OaiPromptTokensDetails {
    #[serde(default)]
    cached_tokens: u32,
}
// OaiUsage gains: #[serde(default)] prompt_tokens_details: OaiPromptTokensDetails
```

### 3. Surfacing cache metrics

Add two fields to the provider-agnostic `TokenUsage` (`provider/mod.rs`):

```rust
pub cache_read_tokens: u32,
pub cache_creation_tokens: u32,
```

Two construction sites update:

- **Anthropic** (`to_token_usage`, `anthropic.rs:126`): populate both from the
  already-parsed `cache_read_input_tokens` / `cache_creation_input_tokens`. The
  existing `prompt_tokens = input_tokens + cache_read_input_tokens` accounting is
  preserved (input_tokens includes cache_creation but not cache_read).
- **OpenAI-compat** (`parse_completion`, `openai_compat.rs:128`): `cache_read_tokens`
  from `cached_tokens`; `cache_creation_tokens` = 0 (not reported by the OpenAI
  shape).

Extend the existing `llm.complete` span and "llm call complete" log at
`agent/mod.rs:176-209` with `llm_cache_read_tokens` / `llm_cache_creation_tokens`
(underscore field names, matching the existing Loki/Tempo/Prometheus convention)
so hit rate is queryable alongside the existing token fields.

### 4. Fan-out cache-warming via AIMD slow-start

In `plnd_api/src/routes/agent.rs`, change `AimdGate` to a TCP-style slow-start +
congestion-avoidance model:

- `AimdGate::new` starts `limit = 1` (was `max_limit`).
- Add a `slow_start: bool` to `AimdState`, initially `true`.
- `record_outcome`:
  - On rate-limit (429/529): `limit = max(limit / 2, 1)`, `clean_streak = 0`,
    and `slow_start = false` (exit slow-start permanently — the first congestion
    signal is the slow-start threshold).
  - On clean completion **in slow-start**: `limit = min(limit * 2, max_limit)`.
  - On clean completion **in congestion avoidance**: existing behavior —
    `clean_streak += 1`; if `clean_streak >= AIMD_GROW_AFTER` and `limit < max_limit`,
    `limit += 1`, `clean_streak = 0`.

Because non-streaming responses commit their cache write before returning, starting
at `limit = 1` guarantees the first slot completes (and warms the cache) before any
sibling is admitted.

**This deliberately changes #871's behavior** (start-at-max → start-at-1). It has
value independent of caching: ramping from 1 eliminates the initial simultaneous
burst of identical-prefix calls that triggered the 429s #871 was built to absorb.
On Opus, where the sub-4096 prefix means caching is a no-op today, slow-start is
still a strictly better concurrency posture.

## Out of scope (documented)

- Padding the system prompt to clear Opus's 4096-token floor.
- A separate warm-up mechanism (slow-start subsumes it).
- DeepSeek-style `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` parsing
  (only the standard OpenAI `prompt_tokens_details.cached_tokens` shape is wired).

## Testing

- **Anthropic:** `cache_control` serializes onto the last system block (assert JSON
  shape); `to_token_usage` carries `cache_read_tokens` / `cache_creation_tokens`
  through; existing prompt-token accounting tests remain green.
- **OpenAI-compat:** `parse_completion` maps `cached_tokens` → `cache_read_tokens`;
  a response without `prompt_tokens_details` yields 0.
- **AIMD gate:** starts at 1; doubles per clean completion in slow-start
  (1 → 2 → 4 → … → capped at max); first rate-limit halves and switches to the
  `GROW_AFTER=3` cadence; never exceeds `max_limit`. The existing
  `fill_slots_parallel_respects_concurrency_limit` test (peak ≤ max) still holds.

## Acceptance criteria mapping

- [x] `cache_control` plumbed through `AnthropicRequest` (system block); OpenAI-compat
  wired on the response side (automatic caching, no request field).
- [x] Cacheable prefix verified against the model minimum — documented decision that
  it does not qualify on Opus today (Constraint 1), caches on Sonnet/Haiku.
- [x] Fan-out adjusted to warm the cache with one call before releasing the rest, via
  AIMD slow-start (start at 1).
- [x] `cache_read_input_tokens` / `cache_creation_input_tokens` exported to tracing.
