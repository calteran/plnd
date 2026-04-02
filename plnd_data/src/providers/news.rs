use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::providers::dtos::Location;
use crate::providers::error::ExternalClientError;

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
    /// User's location — used by implementations for region-based source selection.
    pub location: Location,
    /// Per-request feed URL override. `None` means use the provider's default.
    pub feed_url: Option<String>,
    /// Maximum number of headlines to return.
    pub limit: usize,
}

/// Trait for fetching news headlines.
#[async_trait]
pub trait NewsProvider: Send + Sync {
    async fn headlines(&self, query: NewsQuery) -> Result<Vec<NewsHeadline>, ExternalClientError>;
}

// ── Pure helper ───────────────────────────────────────────────────────────────

/// Parse RSS/Atom bytes into `NewsHeadline` items, capped at `limit`.
pub fn parse_feed_headlines(content: &[u8], limit: usize) -> Result<Vec<NewsHeadline>, String> {
    use feed_rs::parser;
    let feed = parser::parse(content).map_err(|e| e.to_string())?;
    let headlines = feed
        .entries
        .iter()
        .filter_map(|e| {
            let title = e.title.as_ref().map(|t| t.content.clone())?;
            let url = e.links.first().map(|l| l.href.clone());
            Some(NewsHeadline { title, url })
        })
        .take(limit)
        .collect();
    Ok(headlines)
}

// ── RssFeedProvider ───────────────────────────────────────────────────────────

/// Fetches and parses an RSS/Atom feed from a configurable URL.
pub struct RssFeedProvider {
    http: reqwest::Client,
    default_feed_url: String,
}

impl RssFeedProvider {
    /// `default_feed_url` is used when `NewsQuery.feed_url` is `None`.
    /// Pass an empty string to disable news by default.
    pub fn new(default_feed_url: &str) -> Self {
        Self {
            http: super::build_http_client(),
            default_feed_url: default_feed_url.to_string(),
        }
    }
}

#[async_trait]
impl NewsProvider for RssFeedProvider {
    async fn headlines(&self, query: NewsQuery) -> Result<Vec<NewsHeadline>, ExternalClientError> {
        let feed_url = query.feed_url.as_deref().unwrap_or(&self.default_feed_url);

        if feed_url.is_empty() {
            return Ok(vec![]);
        }

        let resp = self.http.get(feed_url).send().await?;

        let status = resp.status();
        if !status.is_success() {
            return Err(ExternalClientError::HttpError(format!(
                "HTTP {}",
                status.as_u16()
            )));
        }

        let bytes = resp.bytes().await?;

        parse_feed_headlines(&bytes, query.limit).map_err(ExternalClientError::ResponseParseError)
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
}
