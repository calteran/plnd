//! Generic/brand name normalization for branded ingredient ingest (#913).
//!
//! Branded sources (Open Food Facts, USDA Branded) carry composite names like
//! "Great Value Shredded Cheddar Cheese". On promotion we split that into a
//! clean generic `name` plus a structured `brand`, gated by a confidence score
//! so uncertain or brand-less splits leave the original name untouched.

use std::collections::HashMap;
use std::path::Path;

use async_trait::async_trait;
use serde::Deserialize;

/// Minimum LLM confidence required to replace a branded name with its generic
/// form. Below this (or when no brand is detected) the original name is kept.
/// Branded rows stay non-canonical, so a wrong split only mis-names a
/// fallback-lane row — never the canonical layer; a light gate is sufficient.
pub const BRAND_CONFIDENCE_THRESHOLD: f64 = 0.7;

/// A single normalization result: the generic food name, an optional brand, and
/// the model's confidence in the split (0.0-1.0).
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Normalization {
    pub generic_name: String,
    pub brand: Option<String>,
    pub confidence: f64,
}

impl Normalization {
    /// Apply the confidence + brand-presence gate, returning the `(name, brand)`
    /// to persist. Accepts the split only when confidence clears the threshold
    /// and a non-empty brand is present; otherwise keeps the original name.
    pub fn gated(&self, original_name: &str) -> (String, Option<String>) {
        match &self.brand {
            Some(b)
                if self.confidence >= BRAND_CONFIDENCE_THRESHOLD
                    && !b.trim().is_empty()
                    && !self.generic_name.trim().is_empty() =>
            {
                (
                    self.generic_name.trim().to_string(),
                    Some(b.trim().to_string()),
                )
            }
            _ => (original_name.to_string(), None),
        }
    }
}

/// Splits a branded ingredient name into a generic name + brand. Returns `None`
/// when normalization could not be performed (LLM error, parse failure, or no
/// fixture entry) — callers fall back to the original name.
#[async_trait]
pub trait BrandNormalizer: Send + Sync {
    async fn normalize(&self, branded_name: &str) -> Option<Normalization>;
}

/// Deterministic normalizer backed by a JSON map of `branded_name -> Normalization`.
/// Used in debug builds (e2e + integration tests) so promotion never makes a
/// live LLM call. Selected by the `fixture_path` gate in `plnd_api::main`.
#[cfg(debug_assertions)]
pub struct FixtureBrandNormalizer {
    entries: HashMap<String, Normalization>,
}

#[cfg(debug_assertions)]
impl FixtureBrandNormalizer {
    /// Load the fixture map from a JSON file shaped as
    /// `{ "<branded name>": { "generic_name": "...", "brand": "...", "confidence": 0.9 } }`.
    pub fn from_path(path: &Path) -> std::io::Result<Self> {
        let raw = std::fs::read_to_string(path)?;
        let entries: HashMap<String, Normalization> = serde_json::from_str(&raw)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        Ok(Self { entries })
    }

    /// Build directly from entries (used by tests).
    pub fn from_entries(entries: HashMap<String, Normalization>) -> Self {
        Self { entries }
    }
}

#[cfg(debug_assertions)]
#[async_trait]
impl BrandNormalizer for FixtureBrandNormalizer {
    async fn normalize(&self, branded_name: &str) -> Option<Normalization> {
        self.entries.get(branded_name).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gated_accepts_confident_branded_split() {
        let n = Normalization {
            generic_name: "Cheddar cheese".into(),
            brand: Some("Great Value".into()),
            confidence: 0.9,
        };
        assert_eq!(
            n.gated("Great Value Shredded Cheddar Cheese"),
            ("Cheddar cheese".into(), Some("Great Value".into()))
        );
    }

    #[test]
    fn gated_keeps_original_when_below_threshold() {
        let n = Normalization {
            generic_name: "Cheddar cheese".into(),
            brand: Some("Great Value".into()),
            confidence: 0.5,
        };
        assert_eq!(
            n.gated("Great Value Shredded Cheddar Cheese"),
            ("Great Value Shredded Cheddar Cheese".into(), None)
        );
    }

    #[test]
    fn gated_keeps_original_when_no_brand() {
        let n = Normalization {
            generic_name: "Greek yogurt".into(),
            brand: None,
            confidence: 0.95,
        };
        assert_eq!(n.gated("Greek yogurt"), ("Greek yogurt".into(), None));
    }

    #[test]
    fn gated_accepts_at_exact_threshold() {
        let n = Normalization {
            generic_name: "Cheddar cheese".into(),
            brand: Some("Great Value".into()),
            confidence: BRAND_CONFIDENCE_THRESHOLD,
        };
        let (name, brand) = n.gated("Great Value Shredded Cheddar Cheese");
        assert_eq!(name, "Cheddar cheese");
        assert_eq!(brand.as_deref(), Some("Great Value"));
    }

    #[test]
    fn gated_keeps_original_when_brand_is_whitespace() {
        let n = Normalization {
            generic_name: "Cheddar cheese".into(),
            brand: Some("   ".into()),
            confidence: 0.95,
        };
        assert_eq!(
            n.gated("Some Branded Thing"),
            ("Some Branded Thing".into(), None)
        );
    }

    #[cfg(debug_assertions)]
    #[tokio::test]
    async fn fixture_returns_entry_or_none() {
        let mut map = HashMap::new();
        map.insert(
            "Great Value Shredded Cheddar Cheese".to_string(),
            Normalization {
                generic_name: "Cheddar cheese".into(),
                brand: Some("Great Value".into()),
                confidence: 0.92,
            },
        );
        let norm = FixtureBrandNormalizer::from_entries(map);
        assert!(
            norm.normalize("Great Value Shredded Cheddar Cheese")
                .await
                .is_some()
        );
        assert!(norm.normalize("Unknown Product").await.is_none());
    }
}
