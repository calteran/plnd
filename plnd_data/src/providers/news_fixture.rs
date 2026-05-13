//! Fixture-backed `NewsProvider` for e2e tests.
//!
//! Reads captured RSS/Atom feed bytes from disk instead of issuing HTTP requests.
//! Only compiled in debug builds.

#![cfg(debug_assertions)]

use std::path::PathBuf;

use async_trait::async_trait;

use crate::providers::error::ExternalProviderError;
use crate::providers::news::{NewsHeadline, NewsProvider, NewsQuery, parse_feed_entries_with_time};

#[derive(Debug)]
pub struct FixtureNewsProvider {
    feed_paths: Vec<PathBuf>,
}

impl FixtureNewsProvider {
    pub fn new(feed_paths: Vec<PathBuf>) -> Result<Self, ExternalProviderError> {
        for path in &feed_paths {
            if !path.is_file() {
                return Err(ExternalProviderError::ConfigurationError(format!(
                    "fixture feed file not found: {}",
                    path.display()
                )));
            }
        }
        Ok(Self { feed_paths })
    }
}

#[async_trait]
impl NewsProvider for FixtureNewsProvider {
    #[tracing::instrument(
        name = "provider::news_fixture::headlines",
        skip(self),
        fields(provider = "news_fixture", feed_count = self.feed_paths.len())
    )]
    async fn headlines(
        &self,
        query: NewsQuery,
    ) -> Result<Vec<NewsHeadline>, ExternalProviderError> {
        if self.feed_paths.is_empty() {
            return Ok(vec![]);
        }

        let mut all_entries: Vec<(i64, NewsHeadline)> = Vec::new();
        for path in &self.feed_paths {
            let bytes = std::fs::read(path).map_err(|e| {
                ExternalProviderError::ConfigurationError(format!(
                    "failed to read fixture {}: {e}",
                    path.display()
                ))
            })?;
            let entries = parse_feed_entries_with_time(&bytes)
                .map_err(ExternalProviderError::ResponseParseError)?;
            all_entries.extend(entries);
        }

        all_entries.sort_unstable_by_key(|b| std::cmp::Reverse(b.0));

        Ok(all_entries
            .into_iter()
            .take(query.limit)
            .map(|(_, h)| h)
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::dtos::Location;

    const FEED_A: &str = r#"<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>A — Older</title><pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate></item>
  <item><title>A — Newest</title><pubDate>Wed, 03 Jan 2024 00:00:00 +0000</pubDate></item>
</channel></rss>"#;

    const FEED_B: &str = r#"<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>B — Middle</title><pubDate>Tue, 02 Jan 2024 00:00:00 +0000</pubDate></item>
</channel></rss>"#;

    fn london_query(limit: usize) -> NewsQuery {
        NewsQuery {
            location: Location {
                latitude: 51.5074,
                longitude: -0.1278,
            },
            limit,
        }
    }

    #[tokio::test]
    async fn headlines_merges_feeds_newest_first_capped_at_limit() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a.xml");
        let b = tmp.path().join("b.xml");
        std::fs::write(&a, FEED_A).unwrap();
        std::fs::write(&b, FEED_B).unwrap();

        let provider = FixtureNewsProvider::new(vec![a, b]).unwrap();
        let headlines = provider.headlines(london_query(3)).await.unwrap();

        assert_eq!(headlines.len(), 3);
        assert_eq!(headlines[0].title, "A — Newest");
        assert_eq!(headlines[1].title, "B — Middle");
        assert_eq!(headlines[2].title, "A — Older");
    }

    #[tokio::test]
    async fn headlines_respects_limit() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a.xml");
        std::fs::write(&a, FEED_A).unwrap();

        let provider = FixtureNewsProvider::new(vec![a]).unwrap();
        let headlines = provider.headlines(london_query(1)).await.unwrap();

        assert_eq!(headlines.len(), 1);
        assert_eq!(headlines[0].title, "A — Newest");
    }

    #[tokio::test]
    async fn empty_feed_paths_returns_empty_vec() {
        let provider = FixtureNewsProvider::new(vec![]).unwrap();
        let headlines = provider.headlines(london_query(3)).await.unwrap();
        assert!(headlines.is_empty());
    }

    #[tokio::test]
    async fn new_returns_error_when_path_missing() {
        let err =
            FixtureNewsProvider::new(vec![PathBuf::from("/nonexistent/feed.xml")]).unwrap_err();
        assert!(matches!(err, ExternalProviderError::ConfigurationError(_)));
    }

    #[tokio::test]
    async fn headlines_returns_parse_error_on_invalid_xml() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("bad.xml");
        std::fs::write(&path, "not xml %%%").unwrap();

        let provider = FixtureNewsProvider::new(vec![path]).unwrap();
        let err = provider.headlines(london_query(3)).await.unwrap_err();
        assert!(matches!(err, ExternalProviderError::ResponseParseError(_)));
    }
}
