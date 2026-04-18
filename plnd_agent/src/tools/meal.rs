use std::sync::Arc;

use plnd_data::db::error::DatabaseError;
use rust_decimal::prelude::ToPrimitive;
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
            .filter(|r| r.restriction_type == "allergy" || r.restriction_type == "intolerance")
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

        let blocked_ids: Vec<uuid::Uuid> = ingredient_prefs
            .iter()
            .filter(|p| p.is_blocked)
            .map(|p| p.catalog_ingredient_id)
            .collect();

        // Fetch names for blocked ingredients so the LLM can reason about them
        let blocked_ingredients: Vec<serde_json::Value> = if blocked_ids.is_empty() {
            vec![]
        } else {
            sqlx::query_as::<_, (uuid::Uuid, String)>(
                "SELECT ingredient_id, name FROM catalog_ingredients \
                 WHERE ingredient_id = ANY($1::uuid[])",
            )
            .bind(&blocked_ids)
            .fetch_all(&self.0)
            .await
            .map_err(|e| ToolError::Execution {
                tool: self.name().to_string(),
                reason: e.to_string(),
            })?
            .into_iter()
            .map(|(id, name)| serde_json::json!({ "id": id, "name": name }))
            .collect()
        };

        let top_rated: Vec<_> = meal_prefs
            .iter()
            .filter(|m| m.rating.unwrap_or(0) >= 4)
            .collect();

        Ok(serde_json::json!({
            "dietary_restrictions": restrictions,
            "blocked_ingredients": blocked_ingredients,
            "top_rated_meals": top_rated,
        }))
    }
}

// ── EstimateNutritionFromDescriptionTool ─────────────────────────────────────

#[derive(Debug, Default, serde::Serialize)]
struct NutritionTotals {
    calories_kcal: f64,
    protein_g: f64,
    carbohydrates_g: f64,
    fat_g: f64,
}

impl NutritionTotals {
    fn add_scaled(&mut self, nutrition: &serde_json::Value, factor: f64) {
        let get = |key: &str| -> f64 { nutrition.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0) };
        self.calories_kcal += get("calories_kcal") * factor;
        self.protein_g += get("protein_g") * factor;
        self.carbohydrates_g += get("carbohydrates_g") * factor;
        self.fat_g += get("fat_g") * factor;
    }
}

pub struct EstimateNutritionFromDescriptionTool(pub PgPool);

#[async_trait::async_trait]
impl Tool for EstimateNutritionFromDescriptionTool {
    fn name(&self) -> &str {
        "estimate_nutrition_from_description"
    }

    fn description(&self) -> &str {
        "Estimate aggregate nutrition macros for a custom meal by looking up each \
         inferred ingredient in the catalog (USDA FDC / Open Food Facts data). \
         Returns totals with `estimated: true` and lists any ingredients not found \
         in the catalog. Use before calling `resolve_meal_description` on a custom meal."
    }

    fn schema(&self) -> serde_json::Value {
        estimate_nutrition_from_description_schema()
    }

    async fn execute(
        &self,
        _ctx: &ToolContext,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let name =
            input
                .get("name")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ToolError::InvalidInput {
                    tool: self.name().to_string(),
                    reason: "missing required field 'name'".to_string(),
                })?;

        let raw_ingredients = input
            .get("inferred_ingredients")
            .and_then(|v| v.as_array())
            .ok_or_else(|| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "missing required field 'inferred_ingredients'".to_string(),
            })?;

        let mut totals = NutritionTotals::default();
        let mut missing: Vec<String> = Vec::new();

        for item in raw_ingredients {
            let ing_name = item
                .get("name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| ToolError::InvalidInput {
                    tool: self.name().to_string(),
                    reason: "each inferred_ingredient must have a non-empty 'name'".to_string(),
                })?;
            let grams = item.get("grams").and_then(|v| v.as_f64()).unwrap_or(100.0);

            let hits = plnd_data::db::search::search_ingredient_nutrition(&self.0, ing_name, 1)
                .await
                .map_err(|e| db_err(self.name(), e))?;

            match hits.into_iter().next() {
                None => missing.push(ing_name.to_string()),
                Some(ingredient) => {
                    // search_ingredient_nutrition guarantees nutrition IS NOT NULL
                    let nutrition = ingredient.nutrition.as_ref().unwrap();
                    // serving_size_g defaults to 100 g when absent or zero (USDA FDC standard reference)
                    let serving_g = ingredient
                        .serving_size_g
                        .and_then(|d| d.to_f64())
                        .filter(|&d| d > 0.0)
                        .unwrap_or(100.0);
                    let factor = grams / serving_g;
                    totals.add_scaled(nutrition, factor);
                }
            }
        }

        Ok(serde_json::json!({
            "name": name,
            "estimated": true,
            "nutrition": totals,
            "missing": missing,
        }))
    }
}

// ── GetMealNutritionTool ──────────────────────────────────────────────────────

pub struct GetMealNutritionTool(pub PgPool);

#[async_trait::async_trait]
impl Tool for GetMealNutritionTool {
    fn name(&self) -> &str {
        "get_meal_nutrition"
    }

    fn description(&self) -> &str {
        "Return the stored nutrition macros (kcal, protein_g, carbs_g, fat_g) for a known \
         meal reference. Also returns `estimated: true` when the nutrition was estimated \
         rather than measured. Call this to show nutrition context before proposing swaps."
    }

    fn schema(&self) -> serde_json::Value {
        get_meal_nutrition_schema()
    }

    async fn execute(
        &self,
        ctx: &ToolContext,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let meal_ref = input
            .get("meal_ref")
            .ok_or_else(|| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "missing required field 'meal_ref'".to_string(),
            })?;

        let meal_type = meal_ref
            .get("type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "meal_ref.type must be 'catalog' or 'user'".to_string(),
            })?;

        let id_str =
            meal_ref
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ToolError::InvalidInput {
                    tool: self.name().to_string(),
                    reason: "meal_ref.id is required".to_string(),
                })?;

        let id: uuid::Uuid = id_str.parse().map_err(|_| ToolError::InvalidInput {
            tool: self.name().to_string(),
            reason: format!("meal_ref.id is not a valid UUID: {id_str}"),
        })?;

        match meal_type {
            "catalog" => {
                let row: Option<(Option<serde_json::Value>,)> =
                    sqlx::query_as("SELECT nutrition FROM catalog_meals WHERE meal_id = $1")
                        .bind(id)
                        .fetch_optional(&self.0)
                        .await
                        .map_err(|e| db_err(self.name(), DatabaseError::from(e)))?;

                match row {
                    None => Ok(serde_json::json!({ "found": false })),
                    Some((nutrition,)) => {
                        // estimated = false: catalog meals are from authoritative sources (not AI-estimated)
                        Ok(serde_json::json!({
                            "found": true,
                            "estimated": false,
                            "nutrition": nutrition,
                        }))
                    }
                }
            }
            "user" => {
                let row: Option<(Option<serde_json::Value>, bool)> = sqlx::query_as(
                    "SELECT nutrition, nutrition_estimated \
                     FROM user_meals WHERE user_meal_id = $1 AND user_id = $2",
                )
                .bind(id)
                .bind(ctx.user_id)
                .fetch_optional(&self.0)
                .await
                .map_err(|e| db_err(self.name(), DatabaseError::from(e)))?;

                match row {
                    None => Ok(serde_json::json!({ "found": false })),
                    Some((nutrition, estimated)) => Ok(serde_json::json!({
                        "found": true,
                        "estimated": estimated,
                        "nutrition": nutrition,
                    })),
                }
            }
            other => Err(ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: format!("unknown meal_ref.type: {other}"),
            }),
        }
    }
}

// ── GetWeekScheduleTool ───────────────────────────────────────────────────────

/// Echoes the client-provided week schedule state back into the agent context.
///
/// The route handler stashes `MealPlanRequest.current_state` in
/// `AgentContext.extra` as JSON. At registry construction time, this value
/// is baked into the tool so the LLM can explicitly retrieve it.
///
/// The DB is NOT consulted — the request payload is authoritative for which
/// slots are already approved, skipped, or custom.
pub struct GetWeekScheduleTool(pub serde_json::Value);

#[async_trait::async_trait]
impl Tool for GetWeekScheduleTool {
    fn name(&self) -> &str {
        "get_week_schedule"
    }

    fn description(&self) -> &str {
        "Return the current week schedule state: which meal slots are approved, \
         skipped, or have a custom meal. Call this before proposing a plan so you \
         know which slots you must preserve exactly as given."
    }

    fn schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {}
        })
    }

    async fn execute(
        &self,
        _ctx: &ToolContext,
        _input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        Ok(self.0.clone())
    }
}

// ── ProposeMealPlanTool ───────────────────────────────────────────────────────

/// Terminal tool: the LLM calls this with the full week plan it has assembled.
///
/// The input is returned verbatim as the agent's final output. Schema validation
/// in `AgentService::run` enforces `MEAL_PLAN_RESPONSE_SCHEMA` before the API
/// layer ever sees the data. No DB writes here.
pub struct ProposeMealPlanTool;

#[async_trait::async_trait]
impl Tool for ProposeMealPlanTool {
    fn name(&self) -> &str {
        "propose_meal_plan"
    }

    fn description(&self) -> &str {
        "Submit the completed weekly meal plan. Call this as your final action \
         once all open slots are filled. Pass the full week envelope including \
         every meal (approved slots preserved as-is, open slots filled by you)."
    }

    fn schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "required": ["week", "meals"],
            "additionalProperties": false,
            "properties": {
                "week": {
                    "type": "string",
                    "format": "date",
                    "description": "ISO date of the Monday starting this plan week"
                },
                "meals": {
                    "type": "array",
                    "description": "All meal slots for the week",
                    "items": {
                        "type": "object",
                        "required": ["date", "occasion", "meal_ref"],
                        "additionalProperties": false,
                        "properties": {
                            "date":     { "type": "string", "format": "date" },
                            "occasion": { "type": "string", "enum": ["breakfast", "lunch", "dinner", "snack"] },
                            "meal_ref": {
                                "type": "object",
                                "required": ["type", "id"],
                                "additionalProperties": false,
                                "properties": {
                                    "type": { "type": "string", "enum": ["catalog", "user"] },
                                    "id":   { "type": "string", "format": "uuid" }
                                }
                            },
                            "estimated_nutrition": {
                                "type": "object",
                                "required": ["kcal", "protein_g", "carbs_g", "fat_g"],
                                "additionalProperties": false,
                                "properties": {
                                    "kcal":      { "type": "number" },
                                    "protein_g": { "type": "number" },
                                    "carbs_g":   { "type": "number" },
                                    "fat_g":     { "type": "number" }
                                }
                            }
                        }
                    }
                },
                "nutrition_summary": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "avg_kcal":    { "type": "number" },
                        "avg_protein": { "type": "number" },
                        "flags":       { "type": "array", "items": { "type": "string" } }
                    }
                }
            }
        })
    }

    fn is_terminal(&self) -> bool {
        true
    }

    async fn execute(
        &self,
        _ctx: &ToolContext,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        Ok(input)
    }
}

// ── Registration ──────────────────────────────────────────────────────────────

pub fn register_meal_read_tools(registry: &mut ToolRegistry, db: &plnd_data::db::Database) {
    let pool = db.get_pool().clone();
    registry.register(Arc::new(SearchMealCatalogTool(pool.clone())));
    registry.register(Arc::new(GetUserMealLibraryTool(pool.clone())));
    registry.register(Arc::new(GetUserMealPreferencesTool(pool.clone())));
    registry.register(Arc::new(GetMealNutritionTool(pool.clone())));
    registry.register(Arc::new(EstimateNutritionFromDescriptionTool(pool)));
}

/// Registers the terminal tools for the `MealPlanning` use case.
///
/// `week_state` is the client-provided `MealPlanState` JSON, baked into
/// `GetWeekScheduleTool` at construction so the LLM can explicitly retrieve it.
pub fn register_meal_planning_tools(registry: &mut ToolRegistry, week_state: serde_json::Value) {
    registry.register(Arc::new(GetWeekScheduleTool(week_state)));
    registry.register(Arc::new(ProposeMealPlanTool));
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

fn estimate_nutrition_from_description_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "required": ["name", "inferred_ingredients"],
        "additionalProperties": false,
        "properties": {
            "name": {
                "type": "string",
                "description": "Free-text name of the meal (used in the response for display)."
            },
            "inferred_ingredients": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "required": ["name", "grams"],
                    "additionalProperties": false,
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Ingredient name to search in the catalog."
                        },
                        "grams": {
                            "type": "number",
                            "exclusiveMinimum": 0,
                            "description": "Estimated portion size in grams."
                        }
                    }
                }
            }
        }
    })
}

fn get_meal_nutrition_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "required": ["meal_ref"],
        "additionalProperties": false,
        "properties": {
            "meal_ref": {
                "type": "object",
                "required": ["type", "id"],
                "additionalProperties": false,
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["catalog", "user"],
                        "description": "Whether this is a catalog meal or a user personal meal."
                    },
                    "id": {
                        "type": "string",
                        "format": "uuid",
                        "description": "UUID of the meal."
                    }
                }
            }
        }
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
        assert_eq!(get_meal_nutrition_schema()["type"], "object");
        assert_eq!(
            estimate_nutrition_from_description_schema()["type"],
            "object"
        );
    }

    #[test]
    fn estimate_nutrition_schema_requires_name_and_ingredients() {
        let schema = estimate_nutrition_from_description_schema();
        let required = schema["required"].as_array().unwrap();
        assert!(required.iter().any(|v| v.as_str() == Some("name")));
        assert!(required
            .iter()
            .any(|v| v.as_str() == Some("inferred_ingredients")));
    }

    #[test]
    fn estimate_nutrition_schema_has_no_user_id() {
        assert!(!has_user_id_property(
            &estimate_nutrition_from_description_schema()
        ));
    }

    #[test]
    fn get_meal_nutrition_schema_requires_meal_ref() {
        let schema = get_meal_nutrition_schema();
        assert_eq!(schema["type"], "object");
        let required = schema["required"].as_array().unwrap();
        assert!(required.iter().any(|v| v.as_str() == Some("meal_ref")));
        assert!(schema["properties"]["meal_ref"].is_object());
    }

    #[test]
    fn get_meal_nutrition_schema_has_no_user_id() {
        assert!(!has_user_id_property(&get_meal_nutrition_schema()));
    }

    #[test]
    fn get_week_schedule_tool_schema_is_valid() {
        let tool = GetWeekScheduleTool(serde_json::json!({}));
        let schema = tool.schema();
        assert_eq!(schema["type"], "object");
    }

    #[test]
    fn get_week_schedule_tool_is_not_terminal() {
        let tool = GetWeekScheduleTool(serde_json::json!({}));
        assert!(!tool.is_terminal());
    }

    #[test]
    fn propose_meal_plan_tool_is_terminal() {
        assert!(ProposeMealPlanTool.is_terminal());
    }

    #[tokio::test]
    async fn get_week_schedule_echoes_stored_state() {
        let state = serde_json::json!({
            "approved": [],
            "skipped": [{ "date": "2026-04-21", "occasion": "breakfast" }],
            "custom": []
        });
        let tool = GetWeekScheduleTool(state.clone());
        let ctx = crate::tools::ToolContext {
            user_id: uuid::Uuid::new_v4(),
        };
        let result = tool.execute(&ctx, serde_json::json!({})).await.unwrap();
        assert_eq!(result["skipped"][0]["occasion"], "breakfast");
    }

    #[tokio::test]
    async fn propose_meal_plan_returns_input_verbatim() {
        let input = serde_json::json!({
            "week": "2026-04-21",
            "meals": [
                {
                    "date": "2026-04-21",
                    "occasion": "breakfast",
                    "meal_ref": { "type": "catalog", "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
                }
            ]
        });
        let ctx = crate::tools::ToolContext {
            user_id: uuid::Uuid::new_v4(),
        };
        let result = ProposeMealPlanTool
            .execute(&ctx, input.clone())
            .await
            .unwrap();
        assert_eq!(result["week"], "2026-04-21");
        assert_eq!(result["meals"].as_array().unwrap().len(), 1);
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
            plnd_data::db::dietary_restrictions::create(&pool, user_id, "allergy", "peanuts", None)
                .await
                .unwrap();

            let tool = GetUserMealPreferencesTool(pool.clone());
            let ctx = ToolContext { user_id };
            let result = tool.execute(&ctx, serde_json::json!({})).await.unwrap();

            let restrictions = result["dietary_restrictions"].as_array().unwrap();
            assert_eq!(restrictions.len(), 1);
            assert_eq!(restrictions[0]["name"], "peanuts");
            assert!(result["blocked_ingredients"].is_array());
            assert!(result["top_rated_meals"].is_array());
        }

        #[sqlx::test(migrations = "../plnd_data/migrations")]
        async fn get_meal_nutrition_catalog_returns_stored_nutrition(pool: PgPool) {
            let meal_id: uuid::Uuid = sqlx::query_scalar(
                "INSERT INTO catalog_meals \
                 (name, servings, allergens, occasion_tags, tags, \
                  nutrition, nutrition_overridden) \
                 VALUES ('Test Soup', 1.0, '{}', '{\"lunch\"}', '{}', \
                   '{\"calories_kcal\": 200, \"protein_g\": 10}'::jsonb, false) \
                 RETURNING meal_id",
            )
            .fetch_one(&pool)
            .await
            .unwrap();

            let user_id = seed_user(&pool).await;
            let tool = GetMealNutritionTool(pool.clone());
            let ctx = ToolContext { user_id };
            let result = tool
                .execute(
                    &ctx,
                    serde_json::json!({ "meal_ref": { "type": "catalog", "id": meal_id.to_string() } }),
                )
                .await
                .unwrap();

            assert_eq!(result["found"], true);
            assert_eq!(result["estimated"], false);
            assert_eq!(result["nutrition"]["calories_kcal"], 200.0);
        }

        #[sqlx::test(migrations = "../plnd_data/migrations")]
        async fn get_meal_nutrition_user_returns_estimated_flag(pool: PgPool) {
            let user_id = seed_user(&pool).await;
            let pref = plnd_data::db::user_meal_prefs::create_from_description(
                &pool,
                user_id,
                "Custom Stew",
                &["dinner".to_string()],
                Some(serde_json::json!({ "calories_kcal": 350, "protein_g": 20 })),
                true,
            )
            .await
            .unwrap();
            let meal_id = pref.user_meal_id.unwrap();

            let tool = GetMealNutritionTool(pool.clone());
            let ctx = ToolContext { user_id };
            let result = tool
                .execute(
                    &ctx,
                    serde_json::json!({ "meal_ref": { "type": "user", "id": meal_id.to_string() } }),
                )
                .await
                .unwrap();

            assert_eq!(result["found"], true);
            assert_eq!(result["estimated"], true);
            assert_eq!(result["nutrition"]["calories_kcal"], 350.0);
        }

        #[sqlx::test(migrations = "../plnd_data/migrations")]
        async fn estimate_nutrition_aggregates_known_ingredients(pool: PgPool) {
            sqlx::query(
                "INSERT INTO catalog_ingredients \
                 (name, serving_size_g, nutrition, allergens, occasion_tags) \
                 VALUES \
                   ('test pasta', 100.0, \
                    '{\"calories_kcal\": 157, \"protein_g\": 5.8, \"carbohydrates_g\": 30.9, \"fat_g\": 0.9}'::jsonb, \
                    '{}', '{}'), \
                   ('test sauce', 100.0, \
                    '{\"calories_kcal\": 50, \"protein_g\": 1.5, \"carbohydrates_g\": 8.0, \"fat_g\": 1.5}'::jsonb, \
                    '{}', '{}')",
            )
            .execute(&pool)
            .await
            .unwrap();

            let user_id = seed_user(&pool).await;
            let tool = EstimateNutritionFromDescriptionTool(pool.clone());
            let ctx = ToolContext { user_id };

            let result = tool
                .execute(
                    &ctx,
                    serde_json::json!({
                        "name": "Pasta with sauce",
                        "inferred_ingredients": [
                            { "name": "test pasta", "grams": 200 },
                            { "name": "test sauce", "grams": 80 }
                        ]
                    }),
                )
                .await
                .unwrap();

            assert_eq!(result["estimated"], true);
            assert_eq!(result["name"], "Pasta with sauce");

            // 200g pasta @ 100g serving: 157*2=314 kcal, 5.8*2=11.6 g protein
            // 80g sauce @ 100g serving: 50*0.8=40 kcal, 1.5*0.8=1.2 g protein
            // total: 354 kcal, 12.8 g protein
            let kcal = result["nutrition"]["calories_kcal"].as_f64().unwrap();
            assert!((kcal - 354.0).abs() < 0.5, "expected ~354 kcal, got {kcal}");

            let protein = result["nutrition"]["protein_g"].as_f64().unwrap();
            assert!(
                (protein - 12.8).abs() < 0.1,
                "expected ~12.8 g protein, got {protein}"
            );

            let missing = result["missing"].as_array().unwrap();
            assert!(missing.is_empty(), "both ingredients should be found");
        }

        #[sqlx::test(migrations = "../plnd_data/migrations")]
        async fn estimate_nutrition_reports_missing_ingredients(pool: PgPool) {
            let user_id = seed_user(&pool).await;
            let tool = EstimateNutritionFromDescriptionTool(pool.clone());
            let ctx = ToolContext { user_id };

            let result = tool
                .execute(
                    &ctx,
                    serde_json::json!({
                        "name": "Mystery dish",
                        "inferred_ingredients": [
                            { "name": "unicorn meat", "grams": 100 }
                        ]
                    }),
                )
                .await
                .unwrap();

            assert_eq!(result["estimated"], true);
            let missing = result["missing"].as_array().unwrap();
            assert_eq!(missing.len(), 1);
            assert_eq!(missing[0], "unicorn meat");
        }

        #[sqlx::test(migrations = "../plnd_data/migrations")]
        async fn get_meal_nutrition_returns_not_found_for_wrong_user(pool: PgPool) {
            let owner = seed_user(&pool).await;
            let other = seed_user(&pool).await;
            let pref = plnd_data::db::user_meal_prefs::create_from_description(
                &pool,
                owner,
                "Private Meal",
                &[],
                None,
                false,
            )
            .await
            .unwrap();
            let meal_id = pref.user_meal_id.unwrap();

            let tool = GetMealNutritionTool(pool.clone());
            let ctx = ToolContext { user_id: other };
            let result = tool
                .execute(
                    &ctx,
                    serde_json::json!({ "meal_ref": { "type": "user", "id": meal_id.to_string() } }),
                )
                .await
                .unwrap();

            assert_eq!(result["found"], false, "should not see another user's meal");
        }
    }
}
