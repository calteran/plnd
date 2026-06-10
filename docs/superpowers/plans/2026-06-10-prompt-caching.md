# LLM Provider Prompt Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Anthropic prompt caching (`cache_control`) to the provider layer, surface cache-hit token counts to tracing, and warm the meal-plan fan-out cache via AIMD slow-start.

**Architecture:** A single `cache_control: {type: "ephemeral"}` breakpoint on the Anthropic `system` block caches tools+system together (render order is tools→system→messages). The provider-agnostic `TokenUsage` gains `cache_read_tokens`/`cache_creation_tokens`, populated by both providers and logged in the existing `llm.complete` span. The `AimdGate` starts concurrency at 1 (TCP-style slow start, exponential ramp) so the first call warms the cache before siblings are admitted.

**Tech Stack:** Rust, `serde`/`serde_json`, `reqwest`, `tracing`, `tokio`, `cargo-nextest`.

**Spec:** `docs/superpowers/specs/2026-06-10-prompt-caching-design.md`

---

## Working directory & conventions

- All paths are relative to the worktree root: `/Users/robert/Development/plnd/.worktrees/feat/869-prompt-caching`.
- Branch: `feat/869-prompt-caching` (already created).
- Per-task commits are local checkpoints validated by targeted `cargo nextest` (pure-logic tests, no Docker). The full `just verify` omnibus gate runs once in Task 6 before the PR.
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.
- Use `git -C <worktree>` for all git commands.

---

## Task 1: Add cache fields to `TokenUsage` and populate from Anthropic

**Files:**
- Modify: `plnd_agent/src/provider/mod.rs` (struct `TokenUsage`, ~line 205)
- Modify: `plnd_agent/src/provider/anthropic.rs` (`AnthropicUsage::to_token_usage`, ~line 126; remove `#[allow(dead_code)]` at ~line 121)
- Modify: `plnd_agent/src/provider/openai_compat.rs` (`parse_completion` usage map, ~line 128) — keep it compiling by setting the new fields to 0 (real wiring lands in Task 3)

- [ ] **Step 1: Update the failing test in `anthropic.rs`**

Replace the body of the existing `usage_deserializes_with_cache_tokens` test (currently ~line 426) so it also asserts the two new fields are carried through:

```rust
    #[test]
    fn usage_deserializes_with_cache_tokens() {
        let json = r#"{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":30,"cache_creation_input_tokens":20}"#;
        let usage: AnthropicUsage = serde_json::from_str(json).unwrap();
        let t = usage.to_token_usage();
        assert_eq!(t.prompt_tokens, 130); // input_tokens (100) + cache_read (30)
        assert_eq!(t.completion_tokens, 50);
        assert_eq!(t.total_tokens, 180);
        assert_eq!(t.prompt_tokens + t.completion_tokens, t.total_tokens);
        // New: raw cache counts surfaced for observability.
        assert_eq!(t.cache_read_tokens, 30);
        assert_eq!(t.cache_creation_tokens, 20);
    }
```

- [ ] **Step 2: Run the test to verify it fails to compile**

Run: `cargo nextest run -p plnd_agent usage_deserializes_with_cache_tokens`
Expected: FAIL — compile error `no field cache_read_tokens on type TokenUsage`.

- [ ] **Step 3: Add the fields to `TokenUsage`**

In `plnd_agent/src/provider/mod.rs`, change the `TokenUsage` struct to:

```rust
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TokenUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
    /// Tokens served from a prompt cache read (Anthropic `cache_read_input_tokens`,
    /// OpenAI `prompt_tokens_details.cached_tokens`). Already included in
    /// `prompt_tokens`; exposed separately for cache-hit-rate observability.
    #[serde(default)]
    pub cache_read_tokens: u32,
    /// Tokens written to the prompt cache on this call (Anthropic
    /// `cache_creation_input_tokens`; 0 for OpenAI-compatible backends).
    #[serde(default)]
    pub cache_creation_tokens: u32,
}
```

- [ ] **Step 4: Populate the fields in `anthropic.rs`**

In `plnd_agent/src/provider/anthropic.rs`, remove the `#[allow(dead_code)]` and its comment from the `cache_creation_input_tokens` field (~line 121-122), then update `to_token_usage`:

```rust
    fn to_token_usage(&self) -> super::TokenUsage {
        let prompt_tokens = self.input_tokens + self.cache_read_input_tokens;
        super::TokenUsage {
            prompt_tokens,
            completion_tokens: self.output_tokens,
            total_tokens: prompt_tokens + self.output_tokens,
            cache_read_tokens: self.cache_read_input_tokens,
            cache_creation_tokens: self.cache_creation_input_tokens,
        }
    }
```

- [ ] **Step 5: Keep `openai_compat.rs` compiling**

In `plnd_agent/src/provider/openai_compat.rs`, update the `usage` map in `parse_completion` (~line 128) to set the new fields to 0 (Task 3 replaces `cache_read_tokens`):

```rust
    let usage = response.usage.map(|u| super::TokenUsage {
        prompt_tokens: u.prompt_tokens,
        completion_tokens: u.completion_tokens,
        total_tokens: u.total_tokens,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
    });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo nextest run -p plnd_agent provider::`
Expected: PASS — all provider tests green (anthropic + openai_compat compile and pass).

- [ ] **Step 7: Commit**

```bash
git -C /Users/robert/Development/plnd/.worktrees/feat/869-prompt-caching add plnd_agent/src/provider/mod.rs plnd_agent/src/provider/anthropic.rs plnd_agent/src/provider/openai_compat.rs
git -C /Users/robert/Development/plnd/.worktrees/feat/869-prompt-caching commit -m "feat(agent): surface cache token counts in TokenUsage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Attach `cache_control` to the Anthropic system block

**Files:**
- Modify: `plnd_agent/src/provider/anthropic.rs` (`AnthropicRequest`, ~line 61; new `AnthropicSystemBlock`/`CacheControl` types; extract `build_body`; update `send_request`, ~line 244)

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `anthropic.rs`:

```rust
    // ── Request body / cache_control ─────────────────────────────────────────

    #[test]
    fn system_block_carries_ephemeral_cache_control() {
        let provider = AnthropicProvider::new("test-key", "claude-test");
        let request = CompletionRequest {
            system: "You are a helpful assistant.".to_string(),
            messages: vec![],
            tools: vec![],
            max_tokens: 256,
        };
        let body = provider.build_body(&request);
        let v = serde_json::to_value(&body).unwrap();

        assert_eq!(v["system"][0]["type"], "text");
        assert_eq!(v["system"][0]["text"], "You are a helpful assistant.");
        assert_eq!(v["system"][0]["cache_control"]["type"], "ephemeral");
    }
```

Note: `CompletionRequest` is already imported via `use super::{... CompletionRequest ...}` at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo nextest run -p plnd_agent system_block_carries_ephemeral_cache_control`
Expected: FAIL — `no method named build_body` / `no field system` shape mismatch.

- [ ] **Step 3: Add the wire types**

In `plnd_agent/src/provider/anthropic.rs`, change `AnthropicRequest` and add the two new types immediately after it (replacing the existing `AnthropicRequest` definition at ~line 61-69):

```rust
#[derive(Serialize)]
struct AnthropicRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    system: Vec<AnthropicSystemBlock<'a>>,
    messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<AnthropicToolDef<'a>>,
}

/// A system-prompt content block. Serialized as an array element so a
/// `cache_control` breakpoint can be attached. Anthropic processes the request
/// prefix in tools -> system -> messages order, so one breakpoint here caches
/// the tool definitions and the system prompt together as a single segment.
#[derive(Serialize)]
struct AnthropicSystemBlock<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    text: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_control: Option<CacheControl>,
}

#[derive(Serialize, Clone, Copy)]
struct CacheControl {
    #[serde(rename = "type")]
    kind: &'static str,
}

impl CacheControl {
    const EPHEMERAL: CacheControl = CacheControl { kind: "ephemeral" };
}
```

- [ ] **Step 4: Extract `build_body` and update `send_request`**

In the `impl AnthropicProvider` block (the one containing `build_messages`/`send_request`), add a `build_body` method and rewrite `send_request` to use it. Replace the body-construction lines in `send_request` (~line 234-250) so the method reads:

```rust
    /// Build the Anthropic wire-format request body, attaching a single
    /// `cache_control: ephemeral` breakpoint to the system block.
    fn build_body<'a>(&'a self, request: &'a CompletionRequest) -> AnthropicRequest<'a> {
        let messages = Self::build_messages(request);
        let tools: Vec<AnthropicToolDef<'a>> = request
            .tools
            .iter()
            .map(|t| AnthropicToolDef {
                name: &t.name,
                description: &t.description,
                input_schema: &t.schema,
            })
            .collect();
        AnthropicRequest {
            model: &self.model,
            max_tokens: request.max_tokens,
            system: vec![AnthropicSystemBlock {
                kind: "text",
                text: &request.system,
                cache_control: Some(CacheControl::EPHEMERAL),
            }],
            messages,
            tools,
        }
    }

    /// Send one HTTP request to the Anthropic messages endpoint.
    async fn send_request(
        &self,
        request: &CompletionRequest,
    ) -> Result<reqwest::Response, LlmError> {
        let body = self.build_body(request);
        let url = format!("{}/v1/messages", self.base_url);
        Ok(self
            .http
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header(
                "anthropic-version",
                self.api_version.as_deref().unwrap_or(ANTHROPIC_VERSION),
            )
            .json(&body)
            .send()
            .await?)
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo nextest run -p plnd_agent provider::anthropic`
Expected: PASS — `system_block_carries_ephemeral_cache_control` and all existing anthropic tests green.

- [ ] **Step 6: Commit**

```bash
git -C /Users/robert/Development/plnd/.worktrees/feat/869-prompt-caching add plnd_agent/src/provider/anthropic.rs
git -C /Users/robert/Development/plnd/.worktrees/feat/869-prompt-caching commit -m "feat(agent): cache_control breakpoint on Anthropic system block

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Parse OpenAI-compat `cached_tokens` into `cache_read_tokens`

**Files:**
- Modify: `plnd_agent/src/provider/openai_compat.rs` (`OaiUsage`, ~line 115; new `OaiPromptTokensDetails`; `parse_completion` usage map, ~line 128)

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `openai_compat.rs`:

```rust
    #[test]
    fn cached_tokens_map_to_cache_read() {
        let response = OaiResponse {
            choices: vec![OaiChoice {
                finish_reason: Some(OaiFinishReason::Stop),
                message: OaiRespMsg {
                    content: Some("hi".to_string()),
                    tool_calls: vec![],
                    function_call: None,
                },
            }],
            usage: Some(OaiUsage {
                prompt_tokens: 100,
                completion_tokens: 10,
                total_tokens: 110,
                prompt_tokens_details: OaiPromptTokensDetails { cached_tokens: 80 },
            }),
        };
        let parsed = parse_completion(response).expect("parse should succeed");
        let usage = parsed.usage.expect("usage present");
        assert_eq!(usage.cache_read_tokens, 80);
        assert_eq!(usage.cache_creation_tokens, 0);
    }

    #[test]
    fn usage_without_prompt_details_defaults_cached_to_zero() {
        let json = r#"{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}"#;
        let usage: OaiUsage = serde_json::from_str(json).unwrap();
        assert_eq!(usage.prompt_tokens_details.cached_tokens, 0);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo nextest run -p plnd_agent -E 'test(cached_tokens_map_to_cache_read) | test(usage_without_prompt_details_defaults_cached_to_zero)'`
Expected: FAIL — `no field prompt_tokens_details on OaiUsage`.

- [ ] **Step 3: Add the details type and extend `OaiUsage`**

In `plnd_agent/src/provider/openai_compat.rs`, replace the `OaiUsage` definition (~line 115-120) with:

```rust
#[derive(Deserialize)]
struct OaiUsage {
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
    /// OpenAI reports cached prefix tokens here. Absent on backends that do not
    /// support automatic prompt caching — defaults to all-zero.
    #[serde(default)]
    prompt_tokens_details: OaiPromptTokensDetails,
}

#[derive(Deserialize, Default)]
struct OaiPromptTokensDetails {
    #[serde(default)]
    cached_tokens: u32,
}
```

- [ ] **Step 4: Wire `cached_tokens` into the usage map**

In `parse_completion` (~line 128), set `cache_read_tokens` from the parsed details:

```rust
    let usage = response.usage.map(|u| super::TokenUsage {
        prompt_tokens: u.prompt_tokens,
        completion_tokens: u.completion_tokens,
        total_tokens: u.total_tokens,
        cache_read_tokens: u.prompt_tokens_details.cached_tokens,
        cache_creation_tokens: 0,
    });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo nextest run -p plnd_agent provider::openai_compat`
Expected: PASS — both new tests and all existing openai_compat tests green.

- [ ] **Step 6: Commit**

```bash
git -C /Users/robert/Development/plnd/.worktrees/feat/869-prompt-caching add plnd_agent/src/provider/openai_compat.rs
git -C /Users/robert/Development/plnd/.worktrees/feat/869-prompt-caching commit -m "feat(agent): map OpenAI cached_tokens to cache_read_tokens

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Surface cache token counts in the `llm.complete` span and log

**Files:**
- Modify: `plnd_agent/src/agent/mod.rs` (span declaration ~line 176-185; usage-recording block ~line 198-209)

This task has no unit test — it extends `tracing` span fields and a structured log, consistent with the existing untested instrumentation at this site. It is verified by `cargo build` and the full `just verify` in Task 6.

- [ ] **Step 1: Add the two `Empty` span fields**

In `plnd_agent/src/agent/mod.rs`, extend the `tracing::info_span!("llm.complete", ...)` declaration (~line 176) to include the two cache fields alongside the existing token fields:

```rust
            let llm_span = tracing::info_span!(
                "llm.complete",
                llm_provider = provider.name(),
                llm_model = provider.model(),
                llm_prompt_tokens = tracing::field::Empty,
                llm_completion_tokens = tracing::field::Empty,
                llm_total_tokens = tracing::field::Empty,
                llm_cache_read_tokens = tracing::field::Empty,
                llm_cache_creation_tokens = tracing::field::Empty,
                otel.status_code = tracing::field::Empty,
                otel.status_message = tracing::field::Empty,
            );
```

- [ ] **Step 2: Record and log the cache fields**

Extend the `if let Some(ref usage) = response.usage { ... }` block (~line 198) to record the new span fields and include them in the structured log:

```rust
            if let Some(ref usage) = response.usage {
                llm_span.record("llm_prompt_tokens", usage.prompt_tokens);
                llm_span.record("llm_completion_tokens", usage.completion_tokens);
                llm_span.record("llm_total_tokens", usage.total_tokens);
                llm_span.record("llm_cache_read_tokens", usage.cache_read_tokens);
                llm_span.record("llm_cache_creation_tokens", usage.cache_creation_tokens);
                tracing::info!(
                    llm_provider = provider.name(),
                    llm_model = provider.model(),
                    llm_prompt_tokens = usage.prompt_tokens,
                    llm_completion_tokens = usage.completion_tokens,
                    llm_total_tokens = usage.total_tokens,
                    llm_cache_read_tokens = usage.cache_read_tokens,
                    llm_cache_creation_tokens = usage.cache_creation_tokens,
                    "llm call complete"
                );
            }
```

- [ ] **Step 3: Verify it compiles and existing agent tests pass**

Run: `cargo nextest run -p plnd_agent agent::`
Expected: PASS — compiles; existing agent tests unaffected.

- [ ] **Step 4: Commit**

```bash
git -C /Users/robert/Development/plnd/.worktrees/feat/869-prompt-caching add plnd_agent/src/agent/mod.rs
git -C /Users/robert/Development/plnd/.worktrees/feat/869-prompt-caching commit -m "feat(agent): log cache_read/cache_creation tokens on llm.complete span

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: AIMD slow-start to warm the fan-out cache

**Files:**
- Modify: `plnd_api/src/routes/agent.rs` (`AimdState` ~line 373; `AimdGate::new` ~line 380; `record_outcome` ~line 415)

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `plnd_api/src/routes/agent.rs`, in the `--- fill_slots_parallel tests ---` section:

```rust
    // --- AimdGate slow-start tests ---

    #[test]
    fn aimd_starts_at_one() {
        let gate = super::AimdGate::new(8);
        assert_eq!(gate.limit(), 1, "slow start must begin at concurrency 1");
    }

    #[test]
    fn aimd_slow_start_doubles_per_clean_completion() {
        let gate = super::AimdGate::new(8);
        assert_eq!(gate.limit(), 1);
        gate.record_outcome(false);
        assert_eq!(gate.limit(), 2);
        gate.record_outcome(false);
        assert_eq!(gate.limit(), 4);
        gate.record_outcome(false);
        assert_eq!(gate.limit(), 8, "doubling caps at max_limit");
        gate.record_outcome(false);
        assert_eq!(gate.limit(), 8, "stays capped");
    }

    #[test]
    fn aimd_rate_limit_exits_slow_start_then_additive() {
        let gate = super::AimdGate::new(8);
        gate.record_outcome(false); // 1 -> 2 (slow start)
        gate.record_outcome(false); // 2 -> 4
        gate.record_outcome(true); // rate-limited: 4 -> 2, exit slow start
        assert_eq!(gate.limit(), 2);
        // Congestion avoidance: +1 only after AIMD_GROW_AFTER (3) clean completions.
        gate.record_outcome(false);
        gate.record_outcome(false);
        assert_eq!(gate.limit(), 2, "streak below threshold does not grow");
        gate.record_outcome(false);
        assert_eq!(gate.limit(), 3, "grows by one after a clean streak of three");
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo nextest run -p plnd_api -E 'test(aimd_)'`
Expected: FAIL — `aimd_starts_at_one` asserts 1 but `new` currently starts at `max_limit` (8).

- [ ] **Step 3: Add `slow_start` to `AimdState`**

In `plnd_api/src/routes/agent.rs`, replace the `AimdState` struct (~line 373):

```rust
struct AimdState {
    limit: usize,
    in_flight: usize,
    clean_streak: usize,
    /// True until the first rate-limit is observed. While set, clean completions
    /// double the limit (TCP-style slow start) so the first call warms the prompt
    /// cache alone before concurrency ramps. The first congestion signal exits
    /// slow start permanently.
    slow_start: bool,
}
```

- [ ] **Step 4: Start at 1 in `AimdGate::new`**

Replace the `state` initializer inside `AimdGate::new` (~line 384):

```rust
            state: std::sync::Mutex::new(AimdState {
                limit: 1,
                in_flight: 0,
                clean_streak: 0,
                slow_start: true,
            }),
```

Leave the surrounding `let max_limit = max_limit.max(1);` and the rest of `new` unchanged.

- [ ] **Step 5: Add the slow-start branch to `record_outcome`**

Replace the locked block inside `record_outcome` (~line 416-428) with:

```rust
        {
            let mut s = self.state.lock().expect("AIMD gate poisoned");
            if rate_limited {
                s.limit = (s.limit / 2).max(1);
                s.clean_streak = 0;
                s.slow_start = false;
            } else if s.slow_start {
                s.limit = (s.limit * 2).min(self.max_limit);
            } else {
                s.clean_streak += 1;
                if s.clean_streak >= AIMD_GROW_AFTER && s.limit < self.max_limit {
                    s.limit += 1;
                    s.clean_streak = 0;
                }
            }
        }
```

Leave the trailing `self.notify.notify_one();` unchanged.

- [ ] **Step 6: Update the `AimdGate` doc comment**

Replace the doc comment above `struct AimdGate` (~line 359-366) to describe slow start:

```rust
/// TCP-style slow start + additive-increase / multiplicative-decrease gate.
///
/// Starts at concurrency 1 so the first slot completes alone — warming the
/// shared prompt-cache prefix before any sibling is admitted. While in slow
/// start (no rate-limit seen yet) each clean completion doubles the limit up to
/// `max_limit`. The first rate-limited completion exits slow start, halves the
/// limit (floor 1), and thereafter the limit grows by one only after
/// [`AIMD_GROW_AFTER`] consecutive clean completions. Shrinking below the
/// in-flight count simply stops admitting new work until slots drain — no
/// running slot is cancelled.
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cargo nextest run -p plnd_api -E 'test(aimd_) | test(fill_slots_parallel)'`
Expected: PASS — new slow-start tests green; existing `fill_slots_parallel_respects_concurrency_limit` (peak ≤ max) and `fill_slots_parallel_collects_failures` still pass.

- [ ] **Step 8: Commit**

```bash
git -C /Users/robert/Development/plnd/.worktrees/feat/869-prompt-caching add plnd_api/src/routes/agent.rs
git -C /Users/robert/Development/plnd/.worktrees/feat/869-prompt-caching commit -m "feat(meal-plan): AIMD slow-start to warm the prompt cache (#869)

Start fan-out concurrency at 1 so the first call warms the shared
cache prefix before siblings are admitted; ramp exponentially until the
first rate-limit, then fall back to additive-increase congestion
avoidance.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Full verification, rebase, and PR

**Files:** none (validation + integration)

- [ ] **Step 1: Run the full omnibus gate**

Run: `just verify`
Expected: PASS — quality (fmt/clippy/deny/machete/msrv/ts-lint) + build + Rust/Angular unit tests + e2e all green. Fix any failure before proceeding; a failing gate is never acceptable.

- [ ] **Step 2: Rebase onto latest `origin/main`**

```bash
git -C /Users/robert/Development/plnd/.worktrees/feat/869-prompt-caching fetch origin
git -C /Users/robert/Development/plnd/.worktrees/feat/869-prompt-caching rebase origin/main
```

Resolve any conflicts (most likely in `plnd_api/src/routes/agent.rs` if #871's AIMD code moved). Re-run `just verify` if conflicts were resolved.

- [ ] **Step 3: Push and open the PR**

```bash
git -C /Users/robert/Development/plnd/.worktrees/feat/869-prompt-caching push --force-with-lease -u origin feat/869-prompt-caching
gh pr create --title "feat(agent): prompt caching for the LLM provider layer (#869)" --body "$(cat <<'EOF'
## Summary
Adds Anthropic prompt caching to the provider layer, surfaces cache-hit token counts to tracing, and warms the meal-plan fan-out cache via AIMD slow-start.

- `cache_control: ephemeral` breakpoint on the Anthropic `system` block (caches tools+system together by render order).
- OpenAI-compat: parse `prompt_tokens_details.cached_tokens` (their caching is automatic; no request field).
- `TokenUsage` gains `cache_read_tokens` / `cache_creation_tokens`, logged on the `llm.complete` span.
- `AimdGate` starts at concurrency 1 (TCP slow-start, exponential ramp) so the first call warms the cache before siblings are admitted.

## Documented decisions (per spec)
- The ~1,439-token static prefix is below Opus's 4096-token cache minimum, so caching is a no-op on the production model today; it activates on Sonnet/Haiku and on Opus automatically if the prefix grows. We deliberately do **not** pad the prompt to clear the floor.
- Slow-start replaces #871's start-at-max behavior on purpose — it also eliminates the initial identical-prefix burst that triggered 429s.

Closes #869

Spec: `docs/superpowers/specs/2026-06-10-prompt-caching-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Monitor CI**

Invoke the `monitor-pr` skill to watch CI and address any review comments.

---

## Self-review notes

- **Spec coverage:** AC1 (Anthropic `cache_control`) → Task 2; AC1 (OpenAI-compat) → Task 3; AC2 (prefix vs Opus minimum, documented) → spec + PR body in Task 6; AC3 (fan-out warming) → Task 5; AC4 (cache tokens to tracing) → Tasks 1, 3, 4. All four criteria covered.
- **Type consistency:** `cache_read_tokens` / `cache_creation_tokens` named identically across `TokenUsage` (Task 1), both providers (Tasks 1, 3), and the span/log (Task 4). `slow_start`, `AimdState`, `AimdGate::new`, `record_outcome`, `AIMD_GROW_AFTER` match the existing `agent.rs` names (Task 5).
- **No placeholders:** every code step shows complete code; every run step shows an exact command and expected result.
