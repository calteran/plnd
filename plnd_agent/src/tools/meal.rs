use std::sync::Arc;

use plnd_data::db::error::DatabaseError;
use plnd_data::repository::{MealRepository, UserIngredientPrefRepository, UserMealPrefRepository};
use rust_decimal::prelude::ToPrimitive;

use crate::tools::{Tool, ToolContext, ToolError, ToolRegistry};

// ── Helper ────────────────────────────────────────────────────────────────────

fn db_err(tool: &str, e: DatabaseError) -> ToolError {
    ToolError::Execution {
        tool: tool.to_string(),
        reason: e.to_string(),
    }
}

// ── SearchMealCatalogTool ─────────────────────────────────────────────────────

pub struct SearchMealCatalogTool(pub Arc<dyn MealRepository>);

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

        let restrictions = self
            .0
            .list_dietary_restrictions(ctx.user_id)
            .await
            .map_err(|e| db_err(self.name(), e))?;
        let allergens: Vec<String> = restrictions
            .iter()
            .filter(|r| r.restriction_type == "allergy" || r.restriction_type == "intolerance")
            .map(|r| r.name.clone())
            .collect();

        let meals = self
            .0
            .search_catalog_meals(
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

pub struct GetUserMealLibraryTool(pub Arc<dyn UserMealPrefRepository>);

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

        let mut meals = self
            .0
            .list(ctx.user_id)
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

pub struct GetUserMealPreferencesTool {
    pub meal: Arc<dyn MealRepository>,
    pub ingredient_pref: Arc<dyn UserIngredientPrefRepository>,
    pub meal_pref: Arc<dyn UserMealPrefRepository>,
}

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
            self.meal.list_dietary_restrictions(ctx.user_id),
            self.ingredient_pref.list(ctx.user_id),
            self.meal_pref.list(ctx.user_id),
        )
        .map_err(|e| db_err(self.name(), e))?;

        let blocked_ids: Vec<uuid::Uuid> = ingredient_prefs
            .iter()
            .filter(|p| p.is_blocked)
            .map(|p| p.catalog_ingredient_id)
            .collect();

        // Fetch names for blocked ingredients so the LLM can reason about them
        let blocked_ingredients: Vec<serde_json::Value> = self
            .meal
            .ingredient_names_by_ids(&blocked_ids)
            .await
            .map_err(|e| db_err(self.name(), e))?
            .into_iter()
            .map(|(id, name)| serde_json::json!({ "id": id, "name": name }))
            .collect();

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

pub struct EstimateNutritionFromDescriptionTool(pub Arc<dyn MealRepository>);

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

            let hits = self
                .0
                .search_ingredient_nutrition(ing_name, 1)
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

pub struct GetMealNutritionTool(pub Arc<dyn MealRepository>);

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
                let row = self
                    .0
                    .catalog_meal_nutrition(id)
                    .await
                    .map_err(|e| db_err(self.name(), e))?;

                // Outer Option: meal row existence; inner Option: nutrition populated.
                match row {
                    None => Ok(serde_json::json!({ "found": false })),
                    Some(nutrition) => {
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
                let row = self
                    .0
                    .user_meal_nutrition(id, ctx.user_id)
                    .await
                    .map_err(|e| db_err(self.name(), e))?;

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

// ── RebalanceMealPlanTool ─────────────────────────────────────────────────────

/// Terminal tool: the LLM calls this with the full rebalanced week plan.
///
/// The input is returned verbatim as the agent's final output. Approved,
/// custom, and skipped slots must be reproduced exactly as received from
/// `get_week_schedule`; only unapproved/open slots may be changed.
pub struct RebalanceMealPlanTool;

#[async_trait::async_trait]
impl Tool for RebalanceMealPlanTool {
    fn name(&self) -> &str {
        "rebalance_meal_plan"
    }

    fn description(&self) -> &str {
        "Submit the rebalanced weekly meal plan. Call this as your final action \
         once all open slots are filled. Pass the full week envelope — approved \
         and custom slots must be reproduced exactly as received from \
         get_week_schedule; skipped slots are excluded from the output; \
         only open slots may be changed."
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

// ── SuggestSlotMealTool ───────────────────────────────────────────────────────

/// Terminal tool: the LLM calls this with a single meal envelope for the requested slot.
///
/// Input is returned verbatim. Schema validation in `AgentService::run` enforces
/// `SUGGEST_SLOT_RESPONSE_SCHEMA` before the API layer sees the data.
pub struct SuggestSlotMealTool;

#[async_trait::async_trait]
impl Tool for SuggestSlotMealTool {
    fn name(&self) -> &str {
        "suggest_slot_meal"
    }

    fn description(&self) -> &str {
        "Submit your single meal suggestion for the requested slot. Call this as your \
         final action once you have selected a meal. Pass the date, occasion, and meal_ref; \
         include estimated_nutrition if you have it from a prior get_meal_nutrition call."
    }

    fn schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "required": ["date", "occasion", "meal_ref"],
            "additionalProperties": false,
            "properties": {
                "date": {
                    "type": "string",
                    "format": "date",
                    "description": "ISO date for this slot"
                },
                "occasion": {
                    "type": "string",
                    "enum": ["breakfast", "lunch", "dinner", "snack"]
                },
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

// ── ResolveMealDescriptionTool ────────────────────────────────────────────────

/// Terminal tool: resolves a free-text meal description to a `meal_ref`.
///
/// Three branches:
/// - `kind = "catalog"`: returns the catalog meal_ref verbatim (no DB write)
/// - `kind = "user"`:    returns the user meal_ref verbatim (no DB write)
/// - `kind = "new"`: inserts a new `user_meals` row via `create_from_description`
///   with `nutrition_estimated = true`, returns the new meal_ref
pub struct ResolveMealDescriptionTool(pub Arc<dyn UserMealPrefRepository>);

#[async_trait::async_trait]
impl Tool for ResolveMealDescriptionTool {
    fn name(&self) -> &str {
        "resolve_meal_description"
    }

    fn description(&self) -> &str {
        "Submit your meal resolution. Call this once you have identified (or created) \
         the meal. Set kind to 'catalog' for a catalog match, 'user' for a match in the \
         user's personal library, or 'new' to create a new custom meal. Always include \
         a friendly confirmation message."
    }

    fn schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "required": ["kind", "confirmation"],
            "additionalProperties": false,
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": ["catalog", "user", "new"],
                    "description": "Which branch: catalog match, user library match, or new custom meal."
                },
                "catalog_id": {
                    "type": "string",
                    "format": "uuid",
                    "description": "Required when kind='catalog'. UUID of the catalog meal."
                },
                "user_meal_id": {
                    "type": "string",
                    "format": "uuid",
                    "description": "Required when kind='user'. UUID of the user's personal meal."
                },
                "name": {
                    "type": "string",
                    "description": "Required when kind='new'. Display name for the new custom meal."
                },
                "occasion_tags": {
                    "type": "array",
                    "items": { "type": "string", "enum": ["breakfast", "lunch", "dinner", "snack"] },
                    "description": "Required when kind='new'. Occasions this meal fits."
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
                    },
                    "description": "Required when kind='new'. Estimated macros (translate calories_kcal→kcal, carbohydrates_g→carbs_g from estimate_nutrition_from_description output)."
                },
                "confirmation": {
                    "type": "string",
                    "description": "User-facing message confirming the resolution."
                }
            }
        })
    }

    fn is_terminal(&self) -> bool {
        true
    }

    async fn execute(
        &self,
        ctx: &ToolContext,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let kind = input["kind"]
            .as_str()
            .ok_or_else(|| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "missing field: kind".to_string(),
            })?;
        let confirmation = input["confirmation"]
            .as_str()
            .ok_or_else(|| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "missing field: confirmation".to_string(),
            })?
            .to_string();

        match kind {
            "catalog" => {
                let id = input["catalog_id"]
                    .as_str()
                    .ok_or_else(|| ToolError::InvalidInput {
                        tool: self.name().to_string(),
                        reason: "kind='catalog' requires catalog_id".to_string(),
                    })?;
                Ok(serde_json::json!({
                    "meal_ref": { "type": "catalog", "id": id },
                    "confirmation": confirmation
                }))
            }
            "user" => {
                let id = input["user_meal_id"]
                    .as_str()
                    .ok_or_else(|| ToolError::InvalidInput {
                        tool: self.name().to_string(),
                        reason: "kind='user' requires user_meal_id".to_string(),
                    })?;
                Ok(serde_json::json!({
                    "meal_ref": { "type": "user", "id": id },
                    "confirmation": confirmation
                }))
            }
            "new" => {
                let name = input["name"]
                    .as_str()
                    .ok_or_else(|| ToolError::InvalidInput {
                        tool: self.name().to_string(),
                        reason: "kind='new' requires name".to_string(),
                    })?;
                static EMPTY: &[serde_json::Value] = &[];
                let occasion_tags: Vec<String> = input["occasion_tags"]
                    .as_array()
                    .map(|v| v.as_slice())
                    .unwrap_or(EMPTY)
                    .iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect();
                let nutrition_json = if input["estimated_nutrition"].is_object() {
                    Some(input["estimated_nutrition"].clone())
                } else {
                    None
                };

                let pref = self
                    .0
                    .create_from_description(
                        ctx.user_id,
                        name,
                        &occasion_tags,
                        nutrition_json.clone(),
                        true,
                    )
                    .await
                    .map_err(|e| db_err(self.name(), e))?;

                let meal_id = pref.user_meal_id.ok_or_else(|| ToolError::Execution {
                    tool: self.name().to_string(),
                    reason: "create_from_description returned pref without user_meal_id"
                        .to_string(),
                })?;

                let mut response = serde_json::json!({
                    "meal_ref": { "type": "user", "id": meal_id.to_string() },
                    "confirmation": confirmation
                });
                if let Some(ref n) = nutrition_json {
                    response["estimated_nutrition"] = n.clone();
                }
                Ok(response)
            }
            other => Err(ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: format!("unknown kind: '{other}' — expected 'catalog', 'user', or 'new'"),
            }),
        }
    }
}

// ── Registration ──────────────────────────────────────────────────────────────

pub fn register_meal_read_tools(
    registry: &mut ToolRegistry,
    meal_repo: Arc<dyn MealRepository>,
    ingredient_pref_repo: Arc<dyn UserIngredientPrefRepository>,
    user_meal_pref_repo: Arc<dyn UserMealPrefRepository>,
) {
    registry.register(Arc::new(SearchMealCatalogTool(Arc::clone(&meal_repo))));
    registry.register(Arc::new(GetUserMealLibraryTool(Arc::clone(
        &user_meal_pref_repo,
    ))));
    registry.register(Arc::new(GetUserMealPreferencesTool {
        meal: Arc::clone(&meal_repo),
        ingredient_pref: ingredient_pref_repo,
        meal_pref: Arc::clone(&user_meal_pref_repo),
    }));
    registry.register(Arc::new(GetMealNutritionTool(Arc::clone(&meal_repo))));
    registry.register(Arc::new(EstimateNutritionFromDescriptionTool(meal_repo)));
}

/// Registers the terminal tools for the `MealPlanning` use case.
///
/// `week_state` is the client-provided `MealPlanState` JSON, baked into
/// `GetWeekScheduleTool` at construction so the LLM can explicitly retrieve it.
pub fn register_meal_planning_tools(registry: &mut ToolRegistry, week_state: serde_json::Value) {
    registry.register(Arc::new(GetWeekScheduleTool(week_state)));
    registry.register(Arc::new(ProposeMealPlanTool));
}

/// Registers the terminal tools for the `MealRebalance` use case.
///
/// `week_state` is the client-provided `MealPlanState` JSON (the existing
/// week schedule), baked into `GetWeekScheduleTool` at construction so the
/// LLM can explicitly retrieve it.
pub fn register_meal_rebalance_tools(registry: &mut ToolRegistry, week_state: serde_json::Value) {
    registry.register(Arc::new(GetWeekScheduleTool(week_state)));
    registry.register(Arc::new(RebalanceMealPlanTool));
}

/// Registers the terminal tool for the `MealSuggestSlot` use case.
pub fn register_meal_suggest_slot_tools(registry: &mut ToolRegistry) {
    registry.register(Arc::new(SuggestSlotMealTool));
}

/// Registers the terminal tool for the `MealAdhocResolve` use case.
pub fn register_meal_adhoc_resolve_tools(
    registry: &mut ToolRegistry,
    user_meal_pref_repo: Arc<dyn UserMealPrefRepository>,
) {
    registry.register(Arc::new(ResolveMealDescriptionTool(user_meal_pref_repo)));
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

    // ── Minimal stubs for unit tests that don't need DB access ───────────────

    struct StubUserMealPrefRepo;

    #[async_trait::async_trait]
    impl UserMealPrefRepository for StubUserMealPrefRepo {
        async fn list(
            &self,
            _user_id: uuid::Uuid,
        ) -> Result<
            Vec<plnd_data::db::models::UserMealPrefDetail>,
            plnd_data::db::error::DatabaseError,
        > {
            unimplemented!("stub")
        }
        async fn get(
            &self,
            _user_id: uuid::Uuid,
            _pref_id: uuid::Uuid,
        ) -> Result<
            Option<plnd_data::db::models::UserMealPrefDetail>,
            plnd_data::db::error::DatabaseError,
        > {
            unimplemented!("stub")
        }
        async fn create_from_catalog(
            &self,
            _user_id: uuid::Uuid,
            _catalog_meal_id: uuid::Uuid,
        ) -> Result<plnd_data::db::models::UserMealPrefDetail, plnd_data::db::error::DatabaseError>
        {
            unimplemented!("stub")
        }
        async fn create_from_scratch(
            &self,
            _user_id: uuid::Uuid,
            _name: &str,
            _description: Option<&str>,
        ) -> Result<plnd_data::db::models::UserMealPrefDetail, plnd_data::db::error::DatabaseError>
        {
            unimplemented!("stub")
        }
        async fn create_from_description(
            &self,
            _user_id: uuid::Uuid,
            _name: &str,
            _occasion_tags: &[String],
            _nutrition: Option<serde_json::Value>,
            _estimated: bool,
        ) -> Result<plnd_data::db::models::UserMealPrefDetail, plnd_data::db::error::DatabaseError>
        {
            unimplemented!("stub")
        }
        async fn update_metadata(
            &self,
            _user_id: uuid::Uuid,
            _pref_id: uuid::Uuid,
            _rating: Option<Option<i16>>,
            _is_safe_food: Option<bool>,
            _is_blocked: Option<bool>,
            _notes: Option<Option<String>>,
        ) -> Result<
            Option<plnd_data::db::models::UserMealPrefDetail>,
            plnd_data::db::error::DatabaseError,
        > {
            unimplemented!("stub")
        }
        async fn fork_and_update_recipe(
            &self,
            _user_id: uuid::Uuid,
            _pref_id: uuid::Uuid,
            _name: Option<&str>,
            _description: Option<&str>,
        ) -> Result<
            Option<plnd_data::db::models::UserMealPrefDetail>,
            plnd_data::db::error::DatabaseError,
        > {
            unimplemented!("stub")
        }
        async fn delete(
            &self,
            _user_id: uuid::Uuid,
            _pref_id: uuid::Uuid,
        ) -> Result<bool, plnd_data::db::error::DatabaseError> {
            unimplemented!("stub")
        }
        async fn add_dish(
            &self,
            _user_id: uuid::Uuid,
            _pref_id: uuid::Uuid,
            _params: plnd_data::repository::user_meal_pref::AddDishParams,
        ) -> Result<
            Option<plnd_data::db::models::UserMealPrefDetail>,
            plnd_data::db::error::DatabaseError,
        > {
            unimplemented!("stub")
        }
        async fn remove_dish(
            &self,
            _user_id: uuid::Uuid,
            _pref_id: uuid::Uuid,
            _meal_dish_id: uuid::Uuid,
        ) -> Result<Option<bool>, plnd_data::db::error::DatabaseError> {
            unimplemented!("stub")
        }
    }

    fn stub_user_meal_pref_repo() -> Arc<dyn UserMealPrefRepository> {
        Arc::new(StubUserMealPrefRepo)
    }

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

    #[test]
    fn suggest_slot_meal_tool_is_terminal() {
        assert!(SuggestSlotMealTool.is_terminal());
    }

    #[test]
    fn suggest_slot_meal_tool_name() {
        assert_eq!(SuggestSlotMealTool.name(), "suggest_slot_meal");
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
    async fn rebalance_meal_plan_tool_preserves_approved_entries() {
        let tool = RebalanceMealPlanTool;
        assert!(tool.is_terminal());
        assert_eq!(tool.name(), "rebalance_meal_plan");

        let input = serde_json::json!({
            "week": "2026-04-21",
            "meals": [
                {
                    "date": "2026-04-21",
                    "occasion": "breakfast",
                    "meal_ref": { "type": "catalog", "id": "00000000-0000-0000-0000-000000000001" }
                },
                {
                    "date": "2026-04-21",
                    "occasion": "lunch",
                    "meal_ref": { "type": "user", "id": "00000000-0000-0000-0000-000000000002" }
                }
            ]
        });

        let ctx = ToolContext {
            user_id: uuid::Uuid::nil(),
        };
        let output = tool.execute(&ctx, input.clone()).await.unwrap();

        assert_eq!(output["week"], "2026-04-21");
        assert_eq!(
            output["meals"][0]["meal_ref"]["id"],
            "00000000-0000-0000-0000-000000000001"
        );
        assert_eq!(
            output["meals"][1]["meal_ref"]["id"],
            "00000000-0000-0000-0000-000000000002"
        );
    }

    #[test]
    fn resolve_meal_description_tool_is_terminal() {
        assert!(ResolveMealDescriptionTool(stub_user_meal_pref_repo()).is_terminal());
    }

    #[test]
    fn resolve_meal_description_tool_name() {
        assert_eq!(
            ResolveMealDescriptionTool(stub_user_meal_pref_repo()).name(),
            "resolve_meal_description"
        );
    }

    #[test]
    fn resolve_meal_description_schema_requires_kind_and_confirmation() {
        let schema = ResolveMealDescriptionTool(stub_user_meal_pref_repo()).schema();
        let required = schema["required"].as_array().unwrap();
        assert!(required.iter().any(|v| v.as_str() == Some("kind")));
        assert!(required.iter().any(|v| v.as_str() == Some("confirmation")));
    }

    #[test]
    fn resolve_meal_description_schema_has_no_user_id() {
        assert!(!has_user_id_property(
            &ResolveMealDescriptionTool(stub_user_meal_pref_repo()).schema()
        ));
    }

    #[tokio::test]
    async fn resolve_meal_description_catalog_branch_echoes_ref() {
        let tool = ResolveMealDescriptionTool(stub_user_meal_pref_repo());
        let ctx = crate::tools::ToolContext {
            user_id: uuid::Uuid::new_v4(),
        };
        let input = serde_json::json!({
            "kind": "catalog",
            "catalog_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            "confirmation": "Matched catalog meal."
        });
        let result = tool.execute(&ctx, input).await.unwrap();
        assert_eq!(result["meal_ref"]["type"], "catalog");
        assert_eq!(
            result["meal_ref"]["id"],
            "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        );
        assert_eq!(result["confirmation"], "Matched catalog meal.");
        assert!(result.get("estimated_nutrition").is_none());
    }

    #[tokio::test]
    async fn resolve_meal_description_user_branch_echoes_ref() {
        let tool = ResolveMealDescriptionTool(stub_user_meal_pref_repo());
        let ctx = crate::tools::ToolContext {
            user_id: uuid::Uuid::new_v4(),
        };
        let input = serde_json::json!({
            "kind": "user",
            "user_meal_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
            "confirmation": "Found your saved grilled cheese."
        });
        let result = tool.execute(&ctx, input).await.unwrap();
        assert_eq!(result["meal_ref"]["type"], "user");
        assert_eq!(
            result["meal_ref"]["id"],
            "b2c3d4e5-f6a7-8901-bcde-f12345678901"
        );
        assert_eq!(result["confirmation"], "Found your saved grilled cheese.");
    }

    #[tokio::test]
    async fn resolve_meal_description_invalid_kind_returns_error() {
        let tool = ResolveMealDescriptionTool(stub_user_meal_pref_repo());
        let ctx = crate::tools::ToolContext {
            user_id: uuid::Uuid::new_v4(),
        };
        let input = serde_json::json!({
            "kind": "unknown",
            "confirmation": "irrelevant"
        });
        let result = tool.execute(&ctx, input).await;
        assert!(result.is_err());
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

    // ── In-memory fakes for tool-logic tests ─────────────────────────────────

    mod fakes {
        use std::collections::HashMap;
        use std::sync::Mutex;

        use plnd_data::db::error::DatabaseError;
        use plnd_data::db::models::{
            CatalogDish, CatalogDishIngredient, CatalogIngredient, CatalogMeal, CatalogMealDish,
            DietaryRestriction, UserIngredientPref, UserMealPrefDetail,
        };
        use plnd_data::repository::{
            MealRepository, UserIngredientPrefRepository, UserMealPrefRepository,
        };
        use rust_decimal::Decimal;
        use uuid::Uuid;

        /// A registered catalog ingredient with nutrition, keyed by name for search.
        pub struct FakeIngredient {
            pub name: String,
            pub serving_size_g: f64,
            pub nutrition: serde_json::Value,
        }

        /// Storage buckets for the in-memory meal fake.
        struct MealStore {
            dietary_restrictions: Vec<DietaryRestriction>,
            catalog_ingredients: Vec<FakeIngredient>,
            /// ingredient_id → name, for ingredient_names_by_ids lookup
            ingredient_names: Vec<(Uuid, String)>,
        }

        pub struct InMemoryMealRepository {
            store: Mutex<MealStore>,
        }

        impl InMemoryMealRepository {
            pub fn new() -> Self {
                Self {
                    store: Mutex::new(MealStore {
                        dietary_restrictions: Vec::new(),
                        catalog_ingredients: Vec::new(),
                        ingredient_names: Vec::new(),
                    }),
                }
            }

            pub fn add_dietary_restriction(
                &self,
                user_id: Uuid,
                restriction_type: &str,
                name: &str,
            ) {
                use chrono::Utc;
                let mut s = self.store.lock().unwrap();
                s.dietary_restrictions.push(DietaryRestriction {
                    restriction_id: Uuid::new_v4(),
                    user_id,
                    restriction_type: restriction_type.to_string(),
                    name: name.to_string(),
                    notes: None,
                    created_at: Utc::now(),
                    updated_at: Utc::now(),
                });
            }

            pub fn add_catalog_ingredient(&self, ing: FakeIngredient) {
                self.store.lock().unwrap().catalog_ingredients.push(ing);
            }

            /// Seed the ingredient name mapping used by `ingredient_names_by_ids`.
            pub fn add_ingredient_name(&self, ingredient_id: Uuid, name: &str) {
                self.store
                    .lock()
                    .unwrap()
                    .ingredient_names
                    .push((ingredient_id, name.to_string()));
            }
        }

        #[async_trait::async_trait]
        impl MealRepository for InMemoryMealRepository {
            async fn list_dietary_restrictions(
                &self,
                user_id: Uuid,
            ) -> Result<Vec<DietaryRestriction>, DatabaseError> {
                let s = self.store.lock().unwrap();
                Ok(s.dietary_restrictions
                    .iter()
                    .filter(|r| r.user_id == user_id)
                    .cloned()
                    .collect())
            }

            async fn search_catalog_meals(
                &self,
                _q: &str,
                _limit: i64,
                _occasion: Option<&str>,
                _exclude_allergens: &[String],
                _user_id: Option<Uuid>,
            ) -> Result<Vec<CatalogMeal>, DatabaseError> {
                unimplemented!("not needed by tool-logic tests")
            }

            async fn ingredient_names_by_ids(
                &self,
                ids: &[Uuid],
            ) -> Result<Vec<(Uuid, String)>, DatabaseError> {
                let s = self.store.lock().unwrap();
                Ok(s.ingredient_names
                    .iter()
                    .filter(|(id, _)| ids.contains(id))
                    .cloned()
                    .collect())
            }

            async fn search_ingredient_nutrition(
                &self,
                q: &str,
                limit: i64,
            ) -> Result<Vec<CatalogIngredient>, DatabaseError> {
                use chrono::Utc;
                let s = self.store.lock().unwrap();
                let results: Vec<CatalogIngredient> = s
                    .catalog_ingredients
                    .iter()
                    .filter(|i| i.name.contains(q))
                    .take(limit as usize)
                    .map(|i| CatalogIngredient {
                        ingredient_id: Uuid::new_v4(),
                        name: i.name.clone(),
                        description: None,
                        serving_size_g: Some(Decimal::try_from(i.serving_size_g).unwrap()),
                        nutrition: Some(i.nutrition.clone()),
                        allergens: vec![],
                        occasion_tags: vec![],
                        external_id: None,
                        external_source: None,
                        contributed_by_user_id: None,
                        created_at: Utc::now(),
                        updated_at: Utc::now(),
                    })
                    .collect();
                Ok(results)
            }

            async fn catalog_meal_nutrition(
                &self,
                _meal_id: Uuid,
            ) -> Result<Option<Option<serde_json::Value>>, DatabaseError> {
                unimplemented!("not needed by tool-logic tests")
            }

            async fn user_meal_nutrition(
                &self,
                _meal_id: Uuid,
                _user_id: Uuid,
            ) -> Result<Option<(Option<serde_json::Value>, bool)>, DatabaseError> {
                unimplemented!("not needed by tool-logic tests")
            }

            async fn create_dietary_restriction(
                &self,
                _user_id: Uuid,
                _restriction_type: &str,
                _name: &str,
                _notes: Option<&str>,
            ) -> Result<DietaryRestriction, DatabaseError> {
                unimplemented!("not needed by tool-logic tests")
            }

            async fn update_dietary_restriction(
                &self,
                _restriction_id: Uuid,
                _user_id: Uuid,
                _notes: Option<&str>,
            ) -> Result<Option<DietaryRestriction>, DatabaseError> {
                unimplemented!("not needed by tool-logic tests")
            }

            async fn delete_dietary_restriction(
                &self,
                _restriction_id: Uuid,
                _user_id: Uuid,
            ) -> Result<bool, DatabaseError> {
                unimplemented!("not needed by tool-logic tests")
            }

            async fn catalog_ingredient(
                &self,
                _id: Uuid,
            ) -> Result<Option<CatalogIngredient>, DatabaseError> {
                unimplemented!("not needed by tool-logic tests")
            }

            async fn catalog_dish(
                &self,
                _id: Uuid,
            ) -> Result<Option<(CatalogDish, Vec<CatalogDishIngredient>)>, DatabaseError>
            {
                unimplemented!("not needed by tool-logic tests")
            }

            async fn catalog_meal(
                &self,
                _id: Uuid,
            ) -> Result<Option<(CatalogMeal, Vec<CatalogMealDish>)>, DatabaseError> {
                unimplemented!("not needed by tool-logic tests")
            }
        }

        // ── InMemoryUserMealPrefRepository ────────────────────────────────────

        struct UserMealPrefStore {
            meal_prefs: Vec<UserMealPrefDetail>,
            /// user_meal_id → (nutrition_json, estimated)
            user_meal_nutrition: HashMap<Uuid, (Option<serde_json::Value>, bool)>,
        }

        pub struct InMemoryUserMealPrefRepository {
            store: Mutex<UserMealPrefStore>,
        }

        impl InMemoryUserMealPrefRepository {
            pub fn new() -> Self {
                Self {
                    store: Mutex::new(UserMealPrefStore {
                        meal_prefs: Vec::new(),
                        user_meal_nutrition: HashMap::new(),
                    }),
                }
            }
        }

        #[async_trait::async_trait]
        impl UserMealPrefRepository for InMemoryUserMealPrefRepository {
            async fn list(&self, user_id: Uuid) -> Result<Vec<UserMealPrefDetail>, DatabaseError> {
                let s = self.store.lock().unwrap();
                Ok(s.meal_prefs
                    .iter()
                    .filter(|m| m.user_id == user_id)
                    .cloned()
                    .collect())
            }

            async fn get(
                &self,
                _user_id: Uuid,
                _pref_id: Uuid,
            ) -> Result<Option<UserMealPrefDetail>, DatabaseError> {
                unimplemented!("not needed by tool-logic tests")
            }

            async fn create_from_catalog(
                &self,
                _user_id: Uuid,
                _catalog_meal_id: Uuid,
            ) -> Result<UserMealPrefDetail, DatabaseError> {
                unimplemented!("not needed by tool-logic tests")
            }

            async fn create_from_scratch(
                &self,
                _user_id: Uuid,
                _name: &str,
                _description: Option<&str>,
            ) -> Result<UserMealPrefDetail, DatabaseError> {
                unimplemented!("not needed by tool-logic tests")
            }

            async fn create_from_description(
                &self,
                user_id: Uuid,
                name: &str,
                occasion_tags: &[String],
                nutrition: Option<serde_json::Value>,
                estimated: bool,
            ) -> Result<UserMealPrefDetail, DatabaseError> {
                use chrono::Utc;
                let meal_id = Uuid::new_v4();
                let pref_id = Uuid::new_v4();
                let pref = UserMealPrefDetail {
                    user_meal_pref_id: pref_id,
                    user_id,
                    catalog_meal_id: None,
                    user_meal_id: Some(meal_id),
                    rating: None,
                    is_safe_food: false,
                    is_blocked: false,
                    notes: None,
                    created_at: Utc::now(),
                    updated_at: Utc::now(),
                    name: name.to_string(),
                    source: "personal".to_string(),
                    has_personal_recipe: false,
                    origin_external_source: None,
                    nutrition_estimated: estimated,
                };
                let mut s = self.store.lock().unwrap();
                s.meal_prefs.push(pref.clone());
                s.user_meal_nutrition
                    .insert(meal_id, (nutrition, estimated));
                let _ = occasion_tags;
                Ok(pref)
            }

            async fn update_metadata(
                &self,
                _user_id: Uuid,
                _pref_id: Uuid,
                _rating: Option<Option<i16>>,
                _is_safe_food: Option<bool>,
                _is_blocked: Option<bool>,
                _notes: Option<Option<String>>,
            ) -> Result<Option<UserMealPrefDetail>, DatabaseError> {
                unimplemented!("not needed by tool-logic tests")
            }

            async fn fork_and_update_recipe(
                &self,
                _user_id: Uuid,
                _pref_id: Uuid,
                _name: Option<&str>,
                _description: Option<&str>,
            ) -> Result<Option<UserMealPrefDetail>, DatabaseError> {
                unimplemented!("not needed by tool-logic tests")
            }

            async fn delete(&self, _user_id: Uuid, _pref_id: Uuid) -> Result<bool, DatabaseError> {
                unimplemented!("not needed by tool-logic tests")
            }

            async fn add_dish(
                &self,
                _user_id: Uuid,
                _pref_id: Uuid,
                _params: plnd_data::repository::user_meal_pref::AddDishParams,
            ) -> Result<Option<UserMealPrefDetail>, DatabaseError> {
                unimplemented!("not needed by tool-logic tests")
            }

            async fn remove_dish(
                &self,
                _user_id: Uuid,
                _pref_id: Uuid,
                _meal_dish_id: Uuid,
            ) -> Result<Option<bool>, DatabaseError> {
                unimplemented!("not needed by tool-logic tests")
            }
        }

        // ── InMemoryUserIngredientPrefRepository ──────────────────────────────

        pub struct InMemoryUserIngredientPrefRepository {
            prefs: Mutex<Vec<UserIngredientPref>>,
        }

        impl InMemoryUserIngredientPrefRepository {
            pub fn new() -> Self {
                Self {
                    prefs: Mutex::new(Vec::new()),
                }
            }

            pub fn add_pref(&self, user_id: Uuid, catalog_ingredient_id: Uuid, is_blocked: bool) {
                use chrono::Utc;
                self.prefs.lock().unwrap().push(UserIngredientPref {
                    user_ingredient_pref_id: Uuid::new_v4(),
                    user_id,
                    catalog_ingredient_id,
                    is_blocked,
                    notes: None,
                    created_at: Utc::now(),
                    updated_at: Utc::now(),
                });
            }
        }

        #[async_trait::async_trait]
        impl UserIngredientPrefRepository for InMemoryUserIngredientPrefRepository {
            async fn list(&self, user_id: Uuid) -> Result<Vec<UserIngredientPref>, DatabaseError> {
                let prefs = self.prefs.lock().unwrap();
                Ok(prefs
                    .iter()
                    .filter(|p| p.user_id == user_id)
                    .cloned()
                    .collect())
            }

            async fn upsert(
                &self,
                _user_id: Uuid,
                _catalog_ingredient_id: Uuid,
                _is_blocked: bool,
                _notes: Option<&str>,
            ) -> Result<UserIngredientPref, DatabaseError> {
                unimplemented!("not needed by tool-logic tests")
            }

            async fn delete(
                &self,
                _user_id: Uuid,
                _catalog_ingredient_id: Uuid,
            ) -> Result<bool, DatabaseError> {
                unimplemented!("not needed by tool-logic tests")
            }
        }
    }

    // ── Tool-logic tests (no DB required) ─────────────────────────────────────

    #[tokio::test]
    async fn get_user_meal_preferences_tool_returns_bundle() {
        use fakes::{
            InMemoryMealRepository, InMemoryUserIngredientPrefRepository,
            InMemoryUserMealPrefRepository,
        };
        let meal_repo = Arc::new(InMemoryMealRepository::new());
        let pref_repo = Arc::new(InMemoryUserIngredientPrefRepository::new());
        let meal_pref_repo = Arc::new(InMemoryUserMealPrefRepository::new());
        let user_id = uuid::Uuid::new_v4();
        meal_repo.add_dietary_restriction(user_id, "allergy", "peanuts");

        // Seed a blocked ingredient so the id→name translation path is exercised.
        let blocked_id = uuid::Uuid::new_v4();
        meal_repo.add_ingredient_name(blocked_id, "shellfish");
        pref_repo.add_pref(user_id, blocked_id, true);

        let tool = GetUserMealPreferencesTool {
            meal: Arc::clone(&meal_repo) as Arc<dyn MealRepository>,
            ingredient_pref: Arc::clone(&pref_repo) as Arc<dyn UserIngredientPrefRepository>,
            meal_pref: Arc::clone(&meal_pref_repo) as Arc<dyn UserMealPrefRepository>,
        };
        let ctx = ToolContext { user_id };
        let result = tool.execute(&ctx, serde_json::json!({})).await.unwrap();

        let restrictions = result["dietary_restrictions"].as_array().unwrap();
        assert_eq!(restrictions.len(), 1);
        assert_eq!(restrictions[0]["name"], "peanuts");

        let blocked = result["blocked_ingredients"].as_array().unwrap();
        assert_eq!(blocked.len(), 1);
        assert_eq!(blocked[0]["id"], blocked_id.to_string());
        assert_eq!(blocked[0]["name"], "shellfish");

        assert!(result["top_rated_meals"].is_array());
    }

    #[tokio::test]
    async fn estimate_nutrition_aggregates_known_ingredients() {
        use fakes::{FakeIngredient, InMemoryMealRepository};
        let repo = Arc::new(InMemoryMealRepository::new());
        repo.add_catalog_ingredient(FakeIngredient {
            name: "test pasta".to_string(),
            serving_size_g: 100.0,
            nutrition: serde_json::json!({
                "calories_kcal": 157.0,
                "protein_g": 5.8,
                "carbohydrates_g": 30.9,
                "fat_g": 0.9
            }),
        });
        repo.add_catalog_ingredient(FakeIngredient {
            name: "test sauce".to_string(),
            serving_size_g: 100.0,
            nutrition: serde_json::json!({
                "calories_kcal": 50.0,
                "protein_g": 1.5,
                "carbohydrates_g": 8.0,
                "fat_g": 1.5
            }),
        });

        let tool =
            EstimateNutritionFromDescriptionTool(Arc::clone(&repo) as Arc<dyn MealRepository>);
        let ctx = ToolContext {
            user_id: uuid::Uuid::new_v4(),
        };
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

    #[tokio::test]
    async fn estimate_nutrition_reports_missing_ingredients() {
        use fakes::InMemoryMealRepository;
        // Empty repo — no ingredients registered, so every lookup misses.
        let repo = Arc::new(InMemoryMealRepository::new());
        let tool =
            EstimateNutritionFromDescriptionTool(Arc::clone(&repo) as Arc<dyn MealRepository>);
        let ctx = ToolContext {
            user_id: uuid::Uuid::new_v4(),
        };
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

    #[tokio::test]
    async fn resolve_meal_description_new_branch_inserts_user_meal() {
        use fakes::InMemoryUserMealPrefRepository;
        let repo = Arc::new(InMemoryUserMealPrefRepository::new());
        let user_id = uuid::Uuid::new_v4();
        let tool = ResolveMealDescriptionTool(Arc::clone(&repo) as Arc<dyn UserMealPrefRepository>);
        let ctx = ToolContext { user_id };
        let input = serde_json::json!({
            "kind": "new",
            "name": "Homemade Grilled Cheese",
            "occasion_tags": ["lunch"],
            "estimated_nutrition": {
                "kcal": 420.0,
                "protein_g": 18.0,
                "carbs_g": 35.0,
                "fat_g": 22.0
            },
            "confirmation": "Created custom grilled cheese with estimated nutrition."
        });
        let result = tool.execute(&ctx, input).await.unwrap();

        assert_eq!(result["meal_ref"]["type"], "user");
        assert!(result["meal_ref"]["id"].as_str().is_some());
        assert_eq!(result["estimated_nutrition"]["kcal"], 420.0);
        assert_eq!(
            result["confirmation"],
            "Created custom grilled cheese with estimated nutrition."
        );
    }

    #[tokio::test]
    async fn resolve_meal_description_new_branch_without_nutrition() {
        use fakes::InMemoryUserMealPrefRepository;
        let repo = Arc::new(InMemoryUserMealPrefRepository::new());
        let user_id = uuid::Uuid::new_v4();
        let tool = ResolveMealDescriptionTool(Arc::clone(&repo) as Arc<dyn UserMealPrefRepository>);
        let ctx = ToolContext { user_id };
        let input = serde_json::json!({
            "kind": "new",
            "name": "Plain Toast",
            "occasion_tags": ["breakfast"],
            "confirmation": "Added plain toast with no nutrition data."
        });
        let result = tool.execute(&ctx, input).await.unwrap();

        assert_eq!(result["meal_ref"]["type"], "user");
        assert!(result["meal_ref"]["id"].as_str().is_some());
        assert!(
            result.get("estimated_nutrition").is_none(),
            "no nutrition key when field absent"
        );
        assert_eq!(
            result["confirmation"],
            "Added plain toast with no nutrition data."
        );
    }

    #[tokio::test]
    async fn suggest_slot_meal_tool_echoes_input() {
        let input = serde_json::json!({
            "date": "2026-04-21",
            "occasion": "lunch",
            "meal_ref": { "type": "catalog", "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
        });
        let ctx = crate::tools::ToolContext {
            user_id: uuid::Uuid::new_v4(),
        };
        let result = SuggestSlotMealTool
            .execute(&ctx, input.clone())
            .await
            .unwrap();
        assert_eq!(result, input);
    }
}
