//! Promotion of LLM-invented meals into the shared catalog.
//!
//! After an agent run, a `meal_ref` may be `{ "type": "new", … }`. This module
//! resolves that proposal against the provider detail-fetch surface and ingests
//! it into `catalog_meals` → `catalog_dishes` → `catalog_ingredients`, returning
//! a concrete catalog meal_ref. On a provider miss it returns `Missed` so the
//! caller can re-invoke the agent constrained to existing items.

use serde::Deserialize;
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
pub struct InferredIngredient {
    pub name: String,
    pub grams: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewMealProposal {
    pub name: String,
    #[serde(default)]
    pub occasion_tags: Vec<String>,
    pub inferred_ingredients: Vec<InferredIngredient>,
}

/// Raw `meal_ref` straight off the agent — either an existing ref or a `new` proposal.
///
/// Note: serde's internally-tagged representation does not support newtype tuple
/// variants that wrap structs, so the `New` variant uses an inline struct form
/// rather than `New(NewMealProposal)`. The standalone `NewMealProposal` struct is
/// kept for use by `promote_new_meal`'s signature and the Task 9 tests.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum RawMealRef {
    Catalog { id: Uuid },
    User { id: Uuid },
    New {
        name: String,
        #[serde(default)]
        occasion_tags: Vec<String>,
        inferred_ingredients: Vec<InferredIngredient>,
    },
}

impl RawMealRef {
    /// Extract a `NewMealProposal` if this is a `New` variant.
    pub fn into_new_proposal(self) -> Option<NewMealProposal> {
        match self {
            RawMealRef::New { name, occasion_tags, inferred_ingredients } => {
                Some(NewMealProposal { name, occasion_tags, inferred_ingredients })
            }
            _ => None,
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum PromotionOutcome {
    /// Existing ref passed through, or a `new` proposal successfully promoted.
    Resolved { meal_type: String, id: Uuid },
    /// Providers had nothing — caller should re-invoke constrained to existing.
    Missed,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_meal_ref_parses_catalog() {
        let v = serde_json::json!({ "type": "catalog", "id": "00000000-0000-0000-0000-000000000001" });
        let r: RawMealRef = serde_json::from_value(v).unwrap();
        assert!(matches!(r, RawMealRef::Catalog { .. }));
    }

    #[test]
    fn raw_meal_ref_parses_user() {
        let v = serde_json::json!({ "type": "user", "id": "00000000-0000-0000-0000-000000000002" });
        let r: RawMealRef = serde_json::from_value(v).unwrap();
        assert!(matches!(r, RawMealRef::User { .. }));
    }

    #[test]
    fn raw_meal_ref_parses_new() {
        let v = serde_json::json!({
            "type": "new",
            "name": "Spicy Peanut Tofu Bowl",
            "occasion_tags": ["dinner"],
            "inferred_ingredients": [{ "name": "tofu", "grams": 150.0 }]
        });
        let r: RawMealRef = serde_json::from_value(v).unwrap();
        match r {
            RawMealRef::New { name, inferred_ingredients, .. } => {
                assert_eq!(name, "Spicy Peanut Tofu Bowl");
                assert_eq!(inferred_ingredients.len(), 1);
            }
            _ => panic!("expected New"),
        }
    }
}
