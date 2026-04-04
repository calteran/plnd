# Design: Make max_iterations Configurable Per Use Case

**Date:** 2026-04-04
**Issue:** calteran/plnd#232
**Status:** Approved

## Context

`AgentService::run()` hardcodes `max_iterations: 10` when constructing `AgentLoop`. This prevents tuning the iteration ceiling per environment or use case without a code change. The fix surfaces `max_iterations` in `LlmModelConfig` alongside the existing `max_tokens` field, using the same pattern already established for that value.

## Decision: Per-Tier in LlmModelConfig

`max_iterations` lives in `LlmModelConfig` (one value per tier: `fast` / `capable`), configured via TOML. This is consistent with how `max_tokens` is handled — no `Option<T>` wrapping, no runtime fallback noise, backward compatible via serde default.

Alternatives considered:
- **Per-UseCase enum method** — compile-time constants, not config-file-tunable; rejected because the acceptance criteria require env/config tunability.
- **Both (config default + UseCase override)** — adds complexity with no current benefit; deferred until a real use case requires it.

## Data Model

`plnd_agent/src/config.rs`:
```rust
fn default_max_iterations() -> u32 { 10 }

pub struct LlmModelConfig {
    // ... existing fields ...
    pub max_tokens: u32,
    #[serde(default = "default_max_iterations")]
    pub max_iterations: u32,
}
```

`config/api/default.toml` (both tiers):
```toml
max_iterations = 10
```

Both tiers default to 10. Values will be tuned per use case once real-world iteration data is available.

## Wiring

`AgentService::run()` dispatches `max_iterations` from config using the same tier-match pattern as `max_tokens`:

```rust
let max_iterations = match tier {
    ProviderTier::Fast    => self.config.fast.max_iterations,
    ProviderTier::Capable => self.config.capable.max_iterations,
};
```

## Testing

Config test (`plnd_api/tests/config_test.rs`) asserts both tiers load `max_iterations = 10` from `default.toml`. Existing `test_max_iterations_enforced` in `plnd_agent` continues to cover `AgentLoop` behaviour via direct construction — no changes needed there.

## Acceptance Criteria

- [x] `max_iterations` is configurable via config file rather than hardcoded
- [x] Existing behaviour preserved when not set (serde default = 10)
- [x] `AgentService::run()` reads the configured value
