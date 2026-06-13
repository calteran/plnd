//! Dev tool (not on the boot path): read USDA Foundation + SR Legacy bulk JSON
//! files, project each food down to the fields we ingest, and write a compact,
//! fdcId-sorted, gzipped JSONL corpus. Invoked by scripts/refresh-usda-corpus.sh.
//!
//! Usage: build_usda_corpus <foundation.json> <sr_legacy.json> <out.jsonl.gz>

use std::io::Write;

use flate2::Compression;
use flate2::write::GzEncoder;
use plnd_data::providers::usda_fdc::parse_bulk_dataset;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        anyhow::bail!("usage: build_usda_corpus <foundation.json> <sr_legacy.json> <out.jsonl.gz>");
    }

    let mut all = Vec::new();
    for path in [&args[1], &args[2]] {
        // The full SR Legacy file is ~205 MB uncompressed; reading it whole is
        // acceptable for an occasional dev tool.
        let json = std::fs::read_to_string(path)?;
        let mut foods = parse_bulk_dataset(&json)
            .map_err(|e| anyhow::anyhow!("parse {path}: {e}"))?;
        all.append(&mut foods);
    }

    // Sort by numeric fdcId for reviewable diffs; dedup defensively.
    all.sort_by_key(|i| i.external_id.parse::<i64>().unwrap_or(i64::MAX));
    all.dedup_by(|a, b| a.external_id == b.external_id);

    let out = std::fs::File::create(&args[3])?;
    let mut enc = GzEncoder::new(out, Compression::default());
    for ing in &all {
        serde_json::to_writer(&mut enc, ing)?;
        enc.write_all(b"\n")?;
    }
    enc.finish()?;

    eprintln!("wrote {} ingredients to {}", all.len(), args[3]);
    Ok(())
}
