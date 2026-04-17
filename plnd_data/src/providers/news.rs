use async_trait::async_trait;
use futures::future::join_all;
use serde::{Deserialize, Serialize};

use crate::providers::dtos::Location;
use crate::providers::error::ExternalProviderError;

// ── Public types ──────────────────────────────────────────────────────────────

/// A single news headline returned by a `NewsProvider`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewsHeadline {
    pub title: String,
    /// Link to the full article, if present in the feed entry.
    pub url: Option<String>,
}

/// Parameters for a news headlines request.
#[derive(Debug, Clone)]
pub struct NewsQuery {
    /// User's location — reserved for future location-based source selection.
    pub location: Location,
    /// Maximum number of headlines to return.
    pub limit: usize,
}

/// Trait for fetching news headlines.
#[async_trait]
pub trait NewsProvider: Send + Sync {
    async fn headlines(&self, query: NewsQuery)
        -> Result<Vec<NewsHeadline>, ExternalProviderError>;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/// Parse RSS/Atom bytes into `NewsHeadline` items, capped at `limit`.
#[cfg(test)]
pub(crate) fn parse_feed_headlines(
    content: &[u8],
    limit: usize,
) -> Result<Vec<NewsHeadline>, String> {
    Ok(parse_feed_entries_with_time(content)?
        .into_iter()
        .take(limit)
        .map(|(_, h)| h)
        .collect())
}

/// Parse RSS/Atom bytes into `(unix_timestamp, NewsHeadline)` pairs.
/// Entries without a publish date fall back to Unix epoch (sort to bottom).
fn parse_feed_entries_with_time(content: &[u8]) -> Result<Vec<(i64, NewsHeadline)>, String> {
    use feed_rs::parser;
    let feed = parser::parse(content).map_err(|e| e.to_string())?;
    let entries = feed
        .entries
        .iter()
        .filter_map(|e| {
            let title = e.title.as_ref().map(|t| t.content.clone())?;
            let url = e.links.first().map(|l| l.href.clone());
            let ts = e
                .published
                .or(e.updated)
                .map(|dt| dt.timestamp())
                .unwrap_or(0);
            Some((ts, NewsHeadline { title, url }))
        })
        .collect();
    Ok(entries)
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async fn fetch_entries(
    http: &reqwest::Client,
    url: &str,
) -> Result<Vec<(i64, NewsHeadline)>, ExternalProviderError> {
    let resp = http.get(url).send().await?;
    let status = resp.status();
    if !status.is_success() {
        return Err(ExternalProviderError::HttpError(format!(
            "HTTP {}",
            status.as_u16()
        )));
    }
    let bytes = resp.bytes().await?;
    parse_feed_entries_with_time(&bytes).map_err(ExternalProviderError::ResponseParseError)
}

// ── RssFeedProvider ───────────────────────────────────────────────────────────

/// Fetches and merges headlines from one or more RSS/Atom feeds.
/// Headlines from all feeds are merged and sorted by publish date (newest first).
pub struct RssFeedProvider {
    http: reqwest::Client,
    feed_urls: Vec<String>,
}

impl RssFeedProvider {
    /// Pass an empty slice to disable news.
    pub fn new(feed_urls: &[String]) -> Self {
        Self {
            http: super::build_http_client(),
            feed_urls: feed_urls.to_vec(),
        }
    }
}

#[async_trait]
impl NewsProvider for RssFeedProvider {
    #[tracing::instrument(
        name = "provider::rss::headlines",
        skip(self),
        fields(provider = "rss", feed_count = self.feed_urls.len())
    )]
    async fn headlines(
        &self,
        query: NewsQuery,
    ) -> Result<Vec<NewsHeadline>, ExternalProviderError> {
        if self.feed_urls.is_empty() {
            return Ok(vec![]);
        }

        let results = join_all(
            self.feed_urls
                .iter()
                .map(|url| fetch_entries(&self.http, url)),
        )
        .await;

        let mut all_entries: Vec<(i64, NewsHeadline)> = Vec::new();
        let mut any_succeeded = false;

        for (url, result) in self.feed_urls.iter().zip(results) {
            match result {
                Ok(entries) => {
                    any_succeeded = true;
                    all_entries.extend(entries);
                }
                Err(e) => {
                    tracing::warn!(feed_url = %url, error = %e, "news feed fetch failed");
                }
            }
        }

        if !any_succeeded {
            return Err(ExternalProviderError::HttpError(
                "all news feeds failed".to_string(),
            ));
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

    #[test]
    fn parse_returns_up_to_limit() {
        let rss = br#"<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>Headline One</title></item>
  <item><title>Headline Two</title></item>
  <item><title>Headline Three</title></item>
  <item><title>Headline Four - should be excluded</title></item>
</channel></rss>"#;
        let result = parse_feed_headlines(rss, 3).unwrap();
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].title, "Headline One");
        assert_eq!(result[2].title, "Headline Three");
    }

    #[test]
    fn parse_empty_feed_returns_empty_vec() {
        let rss = br#"<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>"#;
        let result = parse_feed_headlines(rss, 3).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn parse_fewer_than_limit() {
        let rss = br#"<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>Only One</title></item>
</channel></rss>"#;
        let result = parse_feed_headlines(rss, 3).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].title, "Only One");
    }

    #[test]
    fn parse_invalid_bytes_returns_err() {
        let result = parse_feed_headlines(b"not xml at all %%%", 3);
        assert!(result.is_err());
    }

    #[test]
    fn parse_feed_entries_extracts_timestamps() {
        // parse_feed_entries_with_time returns entries in feed order with parsed timestamps.
        // Sorting newest-first is the provider's responsibility, not the parser's.
        let rss = br#"<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>Older</title><pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate></item>
  <item><title>Newer</title><pubDate>Tue, 02 Jan 2024 00:00:00 +0000</pubDate></item>
</channel></rss>"#;
        let entries = parse_feed_entries_with_time(rss).unwrap();
        assert_eq!(entries.len(), 2);
        // Feed order preserved; Jan 2 timestamp > Jan 1 timestamp
        assert!(
            entries[1].0 > entries[0].0,
            "newer item has larger timestamp"
        );
    }
}
