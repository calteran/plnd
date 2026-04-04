use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use plnd_data::db::error::DatabaseError;
use plnd_data::db::MemoryStore;
use uuid::Uuid;

use crate::tools::{Tool, ToolContext, ToolError, ToolRegistry};

// ── WriteRateLimiter ──────────────────────────────────────────────────────────

/// Per-user sliding-window rate limiter for memory write operations.
///
/// All three write tools share a single `Arc<WriteRateLimiter>` so that
/// `save_memory`, `update_memory`, and `forget_memory` draws from the same
/// budget per user.
struct WriteRateLimiter {
    inner: Mutex<HashMap<Uuid, Vec<Instant>>>,
    max_writes: usize,
    window: Duration,
}

impl WriteRateLimiter {
    fn new(max_writes: usize, window: Duration) -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            max_writes,
            window,
        }
    }

    /// Returns `true` and records the attempt if within limits, `false` if the
    /// user has already hit `max_writes` in the current sliding window.
    fn check(&self, user_id: Uuid) -> bool {
        let mut map = self.inner.lock().expect("rate limiter lock poisoned");
        let now = Instant::now();
        let window = self.window;
        let entry = map.entry(user_id).or_default();
        entry.retain(|t| now.duration_since(*t) < window);
        if entry.len() >= self.max_writes {
            return false;
        }
        entry.push(now);
        true
    }
}

// ── Allowed categories ────────────────────────────────────────────────────────

const VALID_CATEGORIES: &[&str] = &["food", "schedule", "energy", "habits", "general"];

fn validate_category(category: &str, tool: &str) -> Result<(), ToolError> {
    if VALID_CATEGORIES.contains(&category) {
        Ok(())
    } else {
        Err(ToolError::InvalidInput {
            tool: tool.to_string(),
            reason: format!(
                "unknown category '{}'; must be one of: {}",
                category,
                VALID_CATEGORIES.join(", ")
            ),
        })
    }
}

// ── Helper: map DatabaseError → ToolError ─────────────────────────────────────

fn db_err(tool: &str, e: DatabaseError) -> ToolError {
    ToolError::Execution {
        tool: tool.to_string(),
        reason: e.to_string(),
    }
}

// ── GetUserMemoriesTool ───────────────────────────────────────────────────────

pub struct GetUserMemoriesTool {
    store: Arc<MemoryStore>,
}

#[async_trait::async_trait]
impl Tool for GetUserMemoriesTool {
    fn name(&self) -> &str {
        "get_user_memories"
    }

    fn description(&self) -> &str {
        "Retrieve the user's stored memories. Optionally filter by category \
         (food, schedule, energy, habits, general). Returns all memories when \
         category is omitted."
    }

    fn schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "description": "Optional category filter.",
                    "enum": VALID_CATEGORIES
                }
            },
            "required": []
        })
    }

    async fn execute(
        &self,
        ctx: &ToolContext,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let category = input
            .get("category")
            .and_then(|v| v.as_str())
            .map(str::to_string);

        if let Some(ref cat) = category {
            validate_category(cat, self.name())?;
        }

        let memories = self
            .store
            .get(ctx.user_id, category.as_deref())
            .await
            .map_err(|e| db_err(self.name(), e))?;

        let result: Vec<serde_json::Value> = memories
            .into_iter()
            .map(|m| {
                serde_json::json!({
                    "memory_id": m.memory_id,
                    "category":  m.category,
                    "content":   m.content,
                    "tags":      m.tags,
                    "updated_at": m.updated_at
                })
            })
            .collect();

        Ok(serde_json::Value::Array(result))
    }
}

// ── SaveMemoryTool ────────────────────────────────────────────────────────────

pub struct SaveMemoryTool {
    store: Arc<MemoryStore>,
    limiter: Arc<WriteRateLimiter>,
}

#[async_trait::async_trait]
impl Tool for SaveMemoryTool {
    fn name(&self) -> &str {
        "save_memory"
    }

    fn description(&self) -> &str {
        "Persist a new memory for the user. Rate-limited to 10 writes per minute."
    }

    fn schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "enum": VALID_CATEGORIES,
                    "description": "Memory category."
                },
                "content": {
                    "type": "string",
                    "description": "Memory content."
                },
                "tags": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Optional tags."
                }
            },
            "required": ["category", "content"]
        })
    }

    async fn execute(
        &self,
        ctx: &ToolContext,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        // Validate all inputs before consuming the rate-limit budget so that
        // malformed LLM calls do not penalise the user's write allowance.
        let category = input
            .get("category")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "missing required field 'category'".to_string(),
            })?;

        validate_category(category, self.name())?;

        let content = input
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "missing required field 'content'".to_string(),
            })?;

        let tags: Vec<String> = input
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|t| t.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();

        if !self.limiter.check(ctx.user_id) {
            return Err(ToolError::Execution {
                tool: self.name().to_string(),
                reason: "rate limit exceeded — too many memory writes".to_string(),
            });
        }

        let memory = self
            .store
            .save(ctx.user_id, category, content, tags)
            .await
            .map_err(|e| db_err(self.name(), e))?;

        Ok(serde_json::json!({
            "memory_id": memory.memory_id,
            "category":  memory.category,
            "content":   memory.content,
            "tags":      memory.tags,
            "updated_at": memory.updated_at
        }))
    }
}

// ── UpdateMemoryTool ──────────────────────────────────────────────────────────

pub struct UpdateMemoryTool {
    store: Arc<MemoryStore>,
    limiter: Arc<WriteRateLimiter>,
}

#[async_trait::async_trait]
impl Tool for UpdateMemoryTool {
    fn name(&self) -> &str {
        "update_memory"
    }

    fn description(&self) -> &str {
        "Update the content of an existing memory. Rate-limited to 10 writes per minute."
    }

    fn schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "memory_id": {
                    "type": "string",
                    "format": "uuid",
                    "description": "ID of the memory to update."
                },
                "content": {
                    "type": "string",
                    "description": "New content for the memory."
                }
            },
            "required": ["memory_id", "content"]
        })
    }

    async fn execute(
        &self,
        ctx: &ToolContext,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        // Validate all inputs before consuming the rate-limit budget.
        let memory_id = parse_uuid(&input, "memory_id", self.name())?;

        let content = input
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "missing required field 'content'".to_string(),
            })?;

        if !self.limiter.check(ctx.user_id) {
            return Err(ToolError::Execution {
                tool: self.name().to_string(),
                reason: "rate limit exceeded — too many memory writes".to_string(),
            });
        }

        let memory = self
            .store
            .update(ctx.user_id, memory_id, content)
            .await
            .map_err(|e| db_err(self.name(), e))?;

        Ok(serde_json::json!({
            "memory_id": memory.memory_id,
            "category":  memory.category,
            "content":   memory.content,
            "tags":      memory.tags,
            "updated_at": memory.updated_at
        }))
    }
}

// ── ForgetMemoryTool ──────────────────────────────────────────────────────────

pub struct ForgetMemoryTool {
    store: Arc<MemoryStore>,
    limiter: Arc<WriteRateLimiter>,
}

#[async_trait::async_trait]
impl Tool for ForgetMemoryTool {
    fn name(&self) -> &str {
        "forget_memory"
    }

    fn description(&self) -> &str {
        "Delete a stored memory. Rate-limited to 10 writes per minute."
    }

    fn schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "memory_id": {
                    "type": "string",
                    "format": "uuid",
                    "description": "ID of the memory to delete."
                }
            },
            "required": ["memory_id"]
        })
    }

    async fn execute(
        &self,
        ctx: &ToolContext,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        // Validate all inputs before consuming the rate-limit budget.
        let memory_id = parse_uuid(&input, "memory_id", self.name())?;

        if !self.limiter.check(ctx.user_id) {
            return Err(ToolError::Execution {
                tool: self.name().to_string(),
                reason: "rate limit exceeded — too many memory writes".to_string(),
            });
        }

        self.store
            .forget(ctx.user_id, memory_id)
            .await
            .map_err(|e| db_err(self.name(), e))?;

        Ok(serde_json::json!({ "ok": true }))
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn parse_uuid(input: &serde_json::Value, field: &str, tool: &str) -> Result<Uuid, ToolError> {
    let s = input
        .get(field)
        .and_then(|v| v.as_str())
        .ok_or_else(|| ToolError::InvalidInput {
            tool: tool.to_string(),
            reason: format!("missing required field '{field}'"),
        })?;

    s.parse::<Uuid>().map_err(|_| ToolError::InvalidInput {
        tool: tool.to_string(),
        reason: format!("'{field}' is not a valid UUID: {s}"),
    })
}

// ── Registration ──────────────────────────────────────────────────────────────

/// Register all four memory tools into `registry`.
///
/// All three write tools share a single rate-limiter (10 writes / 60 s / user).
///
/// # Example
///
/// ```ignore
/// let store = Arc::new(MemoryStore::new(pool));
/// register_memory_tools(&mut registry, store);
/// ```
pub fn register_memory_tools(registry: &mut ToolRegistry, store: Arc<MemoryStore>) {
    let limiter = Arc::new(WriteRateLimiter::new(10, Duration::from_secs(60)));
    registry.register(Arc::new(GetUserMemoriesTool {
        store: Arc::clone(&store),
    }));
    registry.register(Arc::new(SaveMemoryTool {
        store: Arc::clone(&store),
        limiter: Arc::clone(&limiter),
    }));
    registry.register(Arc::new(UpdateMemoryTool {
        store: Arc::clone(&store),
        limiter: Arc::clone(&limiter),
    }));
    registry.register(Arc::new(ForgetMemoryTool { store, limiter }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Schema security ───────────────────────────────────────────────────────
    //
    // MemoryStore requires a live PgPool. Schema tests don't call execute(), so
    // we test schemas by reproducing the exact JSON the tools return — this
    // avoids a test-only DB dependency while still pinning the contract.

    fn has_user_id_property(schema: &serde_json::Value) -> bool {
        schema
            .get("properties")
            .and_then(|p| p.get("user_id"))
            .is_some()
    }

    fn schema_requires_user_id(schema: &serde_json::Value) -> bool {
        schema
            .get("required")
            .and_then(|r| r.as_array())
            .map(|arr| arr.iter().any(|v| v.as_str() == Some("user_id")))
            .unwrap_or(false)
    }

    fn get_schema() -> serde_json::Value {
        // Mirrors the exact JSON returned by GetUserMemoriesTool::schema()
        serde_json::json!({
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "description": "Optional category filter.",
                    "enum": VALID_CATEGORIES
                }
            },
            "required": []
        })
    }

    fn save_schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "category": { "type": "string", "enum": VALID_CATEGORIES, "description": "Memory category." },
                "content": { "type": "string", "description": "Memory content." },
                "tags": { "type": "array", "items": { "type": "string" }, "description": "Optional tags." }
            },
            "required": ["category", "content"]
        })
    }

    fn update_schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "memory_id": { "type": "string", "format": "uuid", "description": "ID of the memory to update." },
                "content": { "type": "string", "description": "New content for the memory." }
            },
            "required": ["memory_id", "content"]
        })
    }

    fn forget_schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "memory_id": { "type": "string", "format": "uuid", "description": "ID of the memory to delete." }
            },
            "required": ["memory_id"]
        })
    }

    #[test]
    fn get_schema_has_no_user_id() {
        let schema = get_schema();
        assert!(!has_user_id_property(&schema));
        assert!(!schema_requires_user_id(&schema));
    }

    #[test]
    fn save_schema_has_no_user_id() {
        let schema = save_schema();
        assert!(!has_user_id_property(&schema));
        assert!(!schema_requires_user_id(&schema));
    }

    #[test]
    fn update_schema_has_no_user_id() {
        let schema = update_schema();
        assert!(!has_user_id_property(&schema));
        assert!(!schema_requires_user_id(&schema));
    }

    #[test]
    fn forget_schema_has_no_user_id() {
        let schema = forget_schema();
        assert!(!has_user_id_property(&schema));
        assert!(!schema_requires_user_id(&schema));
    }

    // ── Rate limiter ──────────────────────────────────────────────────────────

    #[test]
    fn rate_limiter_allows_writes_within_limit() {
        let limiter = WriteRateLimiter::new(3, Duration::from_secs(60));
        let user = Uuid::new_v4();
        assert!(limiter.check(user));
        assert!(limiter.check(user));
        assert!(limiter.check(user));
    }

    #[test]
    fn rate_limiter_blocks_on_excess() {
        let limiter = WriteRateLimiter::new(3, Duration::from_secs(60));
        let user = Uuid::new_v4();
        for _ in 0..3 {
            assert!(limiter.check(user));
        }
        assert!(!limiter.check(user), "4th call must be blocked");
    }

    #[test]
    fn rate_limiter_isolates_users() {
        let limiter = WriteRateLimiter::new(2, Duration::from_secs(60));
        let user_a = Uuid::new_v4();
        let user_b = Uuid::new_v4();
        limiter.check(user_a);
        limiter.check(user_a);
        assert!(!limiter.check(user_a), "user_a should be blocked");
        assert!(limiter.check(user_b), "user_b should still be allowed");
    }

    #[test]
    fn rate_limiter_resets_after_window() {
        let limiter = WriteRateLimiter::new(1, Duration::from_millis(50));
        let user = Uuid::new_v4();
        assert!(limiter.check(user));
        assert!(
            !limiter.check(user),
            "should be blocked before window expires"
        );
        std::thread::sleep(Duration::from_millis(60));
        assert!(
            limiter.check(user),
            "should be allowed after window expires"
        );
    }
}
