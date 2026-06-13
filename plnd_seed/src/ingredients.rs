use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;
use plnd_data::providers::dtos::ExternalIngredient;
use sqlx::PgConnection;
use uuid::Uuid;

use crate::error::SeedError;

/// Path to the vendored USDA canonical corpus, relative to the workspace root.
/// Callers run from different working directories (the seed bin from the repo
/// root, the API binary from `plnd_api/`), so resolve via [`resolve_corpus_path`]
/// rather than using this constant directly.
pub const USDA_CORPUS_PATH: &str = "plnd_data/corpus/usda_canonical.jsonl.gz";

/// Environment override for the corpus location (absolute path), used by
/// deployments where the workspace layout does not apply.
pub const USDA_CORPUS_PATH_ENV: &str = "APP_USDA_CORPUS_PATH";

/// Resolve the corpus file location independent of the caller's working
/// directory. Precedence:
/// 1. `APP_USDA_CORPUS_PATH` if set (absolute path for containers/prod).
/// 2. The workspace-relative default from the current directory (e.g. `just seed`
///    runs from the repo root).
/// 3. The same path one level up (the API binary runs from `plnd_api/`).
///
/// If none exist, returns the CWD-relative default so the loader surfaces a clear
/// "file not found" error rather than guessing.
pub fn resolve_corpus_path() -> PathBuf {
    if let Ok(p) = std::env::var(USDA_CORPUS_PATH_ENV) {
        return PathBuf::from(p);
    }
    let from_cwd = PathBuf::from(USDA_CORPUS_PATH);
    if from_cwd.is_file() {
        return from_cwd;
    }
    let from_parent = Path::new("..").join(USDA_CORPUS_PATH);
    if from_parent.is_file() {
        return from_parent;
    }
    from_cwd
}

/// Load the vendored USDA canonical corpus: a gzipped JSONL of `ExternalIngredient`
/// records. Every row is tagged source `usda_fdc`. Offline and deterministic.
pub fn load_corpus_ingredients(
    path: &Path,
) -> Result<Vec<(String, ExternalIngredient)>, SeedError> {
    let file = std::fs::File::open(path)?;
    let reader = BufReader::new(GzDecoder::new(file));
    let mut out = Vec::new();
    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let ingredient: ExternalIngredient = serde_json::from_str(&line)?;
        out.push(("usda_fdc".to_string(), ingredient));
    }
    Ok(out)
}

/// Bulk-insert (source, ingredient) pairs into `catalog_ingredients`, batched to
/// keep the ~8k-row corpus load fast. ON CONFLICT DO NOTHING on
/// `uq_ingredient_external` keeps it idempotent. Returns the number inserted.
pub async fn insert_ingredients(
    tx: &mut PgConnection,
    ingredients: &[(String, ExternalIngredient)],
) -> Result<usize, SeedError> {
    let mut inserted = 0usize;
    for chunk in ingredients.chunks(1000) {
        let mut qb = sqlx::QueryBuilder::new(
            "INSERT INTO catalog_ingredients \
             (ingredient_id, name, serving_size_g, nutrition, allergens, occasion_tags, \
              external_id, external_source) ",
        );
        qb.push_values(chunk, |mut b, (source, ing)| {
            let nutrition_json = ing
                .nutrition
                .as_ref()
                .and_then(|n| serde_json::to_value(n).ok());
            b.push_bind(Uuid::new_v4())
                .push_bind(&ing.name)
                .push_bind(ing.serving_size_g)
                .push_bind(nutrition_json)
                .push_bind(&ing.allergens)
                .push_bind(&ing.occasion_tags)
                .push_bind(&ing.external_id)
                .push_bind(source);
        });
        qb.push(" ON CONFLICT ON CONSTRAINT uq_ingredient_external DO NOTHING");
        let res = qb.build().execute(&mut *tx).await?;
        inserted += res.rows_affected() as usize;
    }
    Ok(inserted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::Compression;
    use flate2::write::GzEncoder;
    use std::io::Write;

    fn write_temp_corpus(records: &[ExternalIngredient]) -> tempfile::NamedTempFile {
        let f = tempfile::NamedTempFile::new().unwrap();
        let mut enc = GzEncoder::new(f.reopen().unwrap(), Compression::default());
        for r in records {
            serde_json::to_writer(&mut enc, r).unwrap();
            enc.write_all(b"\n").unwrap();
        }
        enc.finish().unwrap();
        f
    }

    #[test]
    fn load_corpus_reads_gzipped_jsonl() {
        let recs = vec![ExternalIngredient {
            external_id: "173410".to_string(),
            name: "Milk, whole".to_string(),
            serving_size_g: Some(rust_decimal::Decimal::from(100u32)),
            nutrition: None,
            allergens: vec![],
            occasion_tags: vec![],
        }];
        let f = write_temp_corpus(&recs);
        let loaded = load_corpus_ingredients(f.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].0, "usda_fdc");
        assert_eq!(loaded[0].1.name, "Milk, whole");
    }

    #[sqlx::test(migrations = "../plnd_data/migrations")]
    async fn insert_ingredients_bulk_inserts_and_is_idempotent(pool: sqlx::PgPool) {
        let recs = vec![
            ExternalIngredient {
                external_id: "1".to_string(),
                name: "Oats".to_string(),
                serving_size_g: Some(rust_decimal::Decimal::from(40u32)),
                nutrition: Some(plnd_data::providers::dtos::NutritionFacts {
                    calories_kcal: Some(379.0),
                    ..Default::default()
                }),
                allergens: vec![],
                occasion_tags: vec![],
            },
            ExternalIngredient {
                external_id: "2".to_string(),
                name: "Milk".to_string(),
                serving_size_g: None,
                nutrition: None,
                allergens: vec![],
                occasion_tags: vec![],
            },
        ];
        let pairs: Vec<(String, ExternalIngredient)> =
            recs.into_iter().map(|r| ("usda_fdc".to_string(), r)).collect();

        let mut tx = pool.begin().await.unwrap();
        let n = insert_ingredients(&mut tx, &pairs).await.unwrap();
        tx.commit().await.unwrap();
        assert_eq!(n, 2);

        let mut tx = pool.begin().await.unwrap();
        let n2 = insert_ingredients(&mut tx, &pairs).await.unwrap();
        tx.commit().await.unwrap();
        assert_eq!(n2, 0);

        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM catalog_ingredients WHERE external_source = 'usda_fdc'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 2);

        // The nutrition JSONB must round-trip for a nutrition-bearing record
        // (guards the `serde_json::to_value(..).ok()` NULL fallback in the insert).
        let nutrition_present: bool = sqlx::query_scalar(
            "SELECT nutrition IS NOT NULL FROM catalog_ingredients \
             WHERE external_source = 'usda_fdc' AND external_id = '1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(nutrition_present, "Oats record carried nutrition and must persist it");
    }

    #[test]
    fn resolve_corpus_path_prefers_env_override() {
        // SAFETY: single-threaded test; we set and restore the override.
        let key = USDA_CORPUS_PATH_ENV;
        let prev = std::env::var(key).ok();
        unsafe { std::env::set_var(key, "/tmp/explicit/usda.jsonl.gz") };
        assert_eq!(
            resolve_corpus_path(),
            std::path::PathBuf::from("/tmp/explicit/usda.jsonl.gz")
        );
        match prev {
            Some(v) => unsafe { std::env::set_var(key, v) },
            None => unsafe { std::env::remove_var(key) },
        }
    }
}
