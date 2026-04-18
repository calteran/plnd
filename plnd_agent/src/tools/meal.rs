use std::sync::Arc;

use plnd_data::db::error::DatabaseError;
use sqlx::PgPool;

use crate::tools::{Tool, ToolContext, ToolError, ToolRegistry};

// ── Helper ────────────────────────────────────────────────────────────────────

fn db_err(tool: &str, e: DatabaseError) -> ToolError {
    ToolError::Execution {
        tool: tool.to_string(),
        reason: e.to_string(),
    }
}

// ── SearchMealCatalogTool ─────────────────────────────────────────────────────

pub struct SearchMealCatalogTool(pub PgPool);

#[async_trait::async_trait]
impl Tool for SearchMealCatalogTool {
    fn name(&self) -> &str {
        "search_meal_catalog"
    }

    fn description(&self) -> &str {
        "Full-text search over the shared meal catalog. Returns meals matching the query, \
         filtered by occasion if provided, excluding meals the user has blocked. \
         Call get_user_meal_preferences first to learn the user's dietary restrictions."
    }

    fn schema(&self) -> serde_json::Value {
        search_meal_catalog_schema()
    }

    async fn execute(
        &self,
        ctx: &ToolContext,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let q = input
            .get("q")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "missing required field 'q'".to_string(),
            })?
            .to_string();

        let limit = input
            .get("limit")
            .and_then(|v| v.as_i64())
            .unwrap_or(5)
            .clamp(1, 20);

        let occasion = input
            .get("occasion")
            .and_then(|v| v.as_str())
            .map(str::to_string);

        let restrictions = plnd_data::db::dietary_restrictions::list(&self.0, ctx.user_id)
            .await
            .map_err(|e| db_err(self.name(), e))?;
        let allergens: Vec<String> = restrictions
            .iter()
            .filter(|r| r.restriction_type == "allergy")
            .map(|r| r.name.clone())
            .collect();

        let meals = plnd_data::db::search::search_catalog_meals(
            &self.0,
            &q,
            limit,
            occasion.as_deref(),
            &allergens,
            Some(ctx.user_id),
        )
        .await
        .map_err(|e| db_err(self.name(), e))?;

        Ok(serde_json::json!({ "meals": meals }))
    }
}

// ── GetUserMealLibraryTool ────────────────────────────────────────────────────

pub struct GetUserMealLibraryTool(pub PgPool);

#[async_trait::async_trait]
impl Tool for GetUserMealLibraryTool {
    fn name(&self) -> &str {
        "get_user_meal_library"
    }

    fn description(&self) -> &str {
        "Return the user's personal meal library (all meals they have saved, rated, or forked). \
         Provide an optional 'q' to filter by name substring. Excludes blocked meals."
    }

    fn schema(&self) -> serde_json::Value {
        get_user_meal_library_schema()
    }

    async fn execute(
        &self,
        ctx: &ToolContext,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let q = input
            .get("q")
            .and_then(|v| v.as_str())
            .map(|s| s.to_lowercase());

        let mut meals = plnd_data::db::user_meal_prefs::list(&self.0, ctx.user_id)
            .await
            .map_err(|e| db_err(self.name(), e))?;

        meals.retain(|m| !m.is_blocked);

        if let Some(ref filter) = q {
            meals.retain(|m| m.name.to_lowercase().contains(filter.as_str()));
        }

        Ok(serde_json::json!({ "meals": meals }))
    }
}

// ── GetUserMealPreferencesTool ────────────────────────────────────────────────

pub struct GetUserMealPreferencesTool(pub PgPool);

#[async_trait::async_trait]
impl Tool for GetUserMealPreferencesTool {
    fn name(&self) -> &str {
        "get_user_meal_preferences"
    }

    fn description(&self) -> &str {
        "Return the user's meal preferences bundle: dietary restrictions, blocked ingredient IDs, \
         and top-rated meals (rating >= 4). Call this before searching the catalog so you know \
         what to exclude."
    }

    fn schema(&self) -> serde_json::Value {
        get_user_meal_preferences_schema()
    }

    async fn execute(
        &self,
        ctx: &ToolContext,
        _input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let (restrictions, ingredient_prefs, meal_prefs) = tokio::try_join!(
            plnd_data::db::dietary_restrictions::list(&self.0, ctx.user_id),
            plnd_data::db::user_ingredient_prefs::list(&self.0, ctx.user_id),
            plnd_data::db::user_meal_prefs::list(&self.0, ctx.user_id),
        )
        .map_err(|e| db_err(self.name(), e))?;

        let blocked_ingredient_ids: Vec<String> = ingredient_prefs
            .iter()
            .filter(|p| p.is_blocked)
            .map(|p| p.catalog_ingredient_id.to_string())
            .collect();

        let top_rated: Vec<_> = meal_prefs
            .iter()
            .filter(|m| m.rating.unwrap_or(0) >= 4)
            .collect();

        Ok(serde_json::json!({
            "dietary_restrictions": restrictions,
            "blocked_ingredient_ids": blocked_ingredient_ids,
            "top_rated_meals": top_rated,
        }))
    }
}

// ── Registration ──────────────────────────────────────────────────────────────

pub fn register_meal_read_tools(registry: &mut ToolRegistry, db: &plnd_data::db::Database) {
    let pool = db.get_pool().clone();
    registry.register(Arc::new(SearchMealCatalogTool(pool.clone())));
    registry.register(Arc::new(GetUserMealLibraryTool(pool.clone())));
    registry.register(Arc::new(GetUserMealPreferencesTool(pool)));
}

// ── Schema constructors ───────────────────────────────────────────────────────

fn search_meal_catalog_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "required": ["q"],
        "additionalProperties": false,
        "properties": {
            "q": {
                "type": "string",
                "description": "Full-text search query (meal name or description)."
            },
            "occasion": {
                "type": "string",
                "enum": ["breakfast", "lunch", "dinner", "snack"],
                "description": "Filter results to meals tagged for this eating occasion."
            },
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 20,
                "description": "Maximum number of results to return (default 5)."
            }
        }
    })
}

fn get_user_meal_library_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "q": {
                "type": "string",
                "description": "Optional name substring filter (case-insensitive)."
            }
        }
    })
}

fn get_user_meal_preferences_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {}
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn has_user_id_property(schema: &serde_json::Value) -> bool {
        schema
            .get("properties")
            .and_then(|p| p.get("user_id"))
            .is_some()
    }

    fn schema_requires_field(schema: &serde_json::Value, field: &str) -> bool {
        schema
            .get("required")
            .and_then(|r| r.as_array())
            .map(|arr| arr.iter().any(|v| v.as_str() == Some(field)))
            .unwrap_or(false)
    }

    #[test]
    fn search_meal_catalog_schema_has_no_user_id() {
        assert!(!has_user_id_property(&search_meal_catalog_schema()));
    }

    #[test]
    fn search_meal_catalog_schema_requires_q() {
        assert!(schema_requires_field(&search_meal_catalog_schema(), "q"));
    }

    #[test]
    fn search_meal_catalog_schema_has_occasion_enum() {
        let schema = search_meal_catalog_schema();
        let enums = schema["properties"]["occasion"]["enum"].as_array().unwrap();
        assert!(enums.iter().any(|v| v.as_str() == Some("breakfast")));
        assert!(enums.iter().any(|v| v.as_str() == Some("dinner")));
    }

    #[test]
    fn get_user_meal_library_schema_has_no_user_id() {
        assert!(!has_user_id_property(&get_user_meal_library_schema()));
    }

    #[test]
    fn get_user_meal_library_schema_does_not_require_q() {
        assert!(!schema_requires_field(&get_user_meal_library_schema(), "q"));
    }

    #[test]
    fn get_user_meal_preferences_schema_has_no_user_id() {
        assert!(!has_user_id_property(&get_user_meal_preferences_schema()));
    }

    #[test]
    fn all_tool_schemas_are_objects() {
        assert_eq!(search_meal_catalog_schema()["type"], "object");
        assert_eq!(get_user_meal_library_schema()["type"], "object");
        assert_eq!(get_user_meal_preferences_schema()["type"], "object");
    }

    mod integration {
        use super::*;
        use sqlx::PgPool;
        use uuid::Uuid;

        async fn seed_user(pool: &PgPool) -> Uuid {
            plnd_data::db::users::create(
                pool,
                &format!("{}@test.invalid", Uuid::new_v4()),
                None,
                None,
            )
            .await
            .expect("failed to create test user")
            .user_id
        }

        #[sqlx::test(migrations = "../plnd_data/migrations")]
        async fn search_meal_catalog_tool_returns_seeded_meal(pool: PgPool) {
            let user_id = seed_user(&pool).await;
            sqlx::query(
                "INSERT INTO catalog_meals \
                 (name, description, servings, allergens, occasion_tags, tags) \
                 VALUES ('Test Oatmeal', 'hearty oats', 1.0, '{}', '{\"breakfast\"}', '{}')",
            )
            .execute(&pool)
            .await
            .unwrap();

            let tool = SearchMealCatalogTool(pool.clone());
            let ctx = ToolContext { user_id };
            let result = tool
                .execute(&ctx, serde_json::json!({ "q": "oatmeal" }))
                .await
                .unwrap();

            let meals = result["meals"].as_array().unwrap();
            assert!(!meals.is_empty());
            assert_eq!(meals[0]["name"], "Test Oatmeal");
        }

        #[sqlx::test(migrations = "../plnd_data/migrations")]
        async fn get_user_meal_library_tool_returns_created_meal(pool: PgPool) {
            let user_id = seed_user(&pool).await;
            plnd_data::db::user_meal_prefs::create_from_scratch(
                &pool,
                user_id,
                "My Pasta",
                Some("homemade pasta"),
            )
            .await
            .unwrap();

            let tool = GetUserMealLibraryTool(pool.clone());
            let ctx = ToolContext { user_id };
            let result = tool.execute(&ctx, serde_json::json!({})).await.unwrap();

            let meals = result["meals"].as_array().unwrap();
            assert_eq!(meals.len(), 1);
            assert_eq!(meals[0]["name"], "My Pasta");
        }

        #[sqlx::test(migrations = "../plnd_data/migrations")]
        async fn get_user_meal_preferences_tool_returns_bundle(pool: PgPool) {
            let user_id = seed_user(&pool).await;
            plnd_data::db::dietary_restrictions::create(
                &pool, user_id, "allergy", "peanuts", None,
            )
            .await
            .unwrap();

            let tool = GetUserMealPreferencesTool(pool.clone());
            let ctx = ToolContext { user_id };
            let result = tool.execute(&ctx, serde_json::json!({})).await.unwrap();

            let restrictions = result["dietary_restrictions"].as_array().unwrap();
            assert_eq!(restrictions.len(), 1);
            assert_eq!(restrictions[0]["name"], "peanuts");
            assert!(result["blocked_ingredient_ids"].is_array());
            assert!(result["top_rated_meals"].is_array());
        }
    }
}
