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
///
/// RSS 2.0 and Atom are handled by the `rss` and `atom_syndication` crates
/// respectively (both maintained by the rust-syndication org on a patched
/// `quick-xml`). We try RSS first, then Atom; a byte stream that is neither
/// yields a parse error.
pub(crate) fn parse_feed_entries_with_time(
    content: &[u8],
) -> Result<Vec<(i64, NewsHeadline)>, String> {
    match rss::Channel::read_from(content) {
        Ok(channel) => Ok(rss_entries(&channel)),
        Err(rss_err) => match atom_syndication::Feed::read_from(content) {
            Ok(feed) => Ok(atom_entries(&feed)),
            // Neither parser accepted the bytes; surface the RSS error, which
            // is the more common feed shape and usually the more informative.
            Err(_) => Err(rss_err.to_string()),
        },
    }
}

/// Extract headline tuples from a parsed RSS 2.0 channel.
fn rss_entries(channel: &rss::Channel) -> Vec<(i64, NewsHeadline)> {
    channel
        .items()
        .iter()
        .filter_map(|item| {
            let title = item.title()?.to_string();
            if title.trim().is_empty() {
                return None;
            }
            let url = item.link().map(str::to_string);
            // Prefer <pubDate>; fall back to Dublin Core <dc:date>, which many
            // feeds use instead (feed-rs read both).
            let ts = item
                .pub_date()
                .or_else(|| {
                    item.dublin_core_ext()
                        .and_then(|dc| dc.dates().first())
                        .map(String::as_str)
                })
                .and_then(parse_feed_timestamp)
                .unwrap_or(0);
            Some((ts, NewsHeadline { title, url }))
        })
        .collect()
}

/// Extract headline tuples from a parsed Atom feed.
fn atom_entries(feed: &atom_syndication::Feed) -> Vec<(i64, NewsHeadline)> {
    feed.entries()
        .iter()
        .filter_map(|entry| {
            // Atom mandates a <title>, but it may be empty; skip such entries so
            // the UI never shows a blank headline (parity with the RSS branch,
            // which skips title-less items).
            let title = entry.title().to_string();
            if title.trim().is_empty() {
                return None;
            }
            // Atom entries can carry several links (self, edit, alternate…);
            // prefer the "alternate" link (the default when `rel` is absent),
            // falling back to the first link only if none is marked alternate.
            let url = entry
                .links()
                .iter()
                .find(|l| l.rel() == "alternate" || l.rel().is_empty())
                .or_else(|| entry.links().first())
                .map(|l| l.href().to_string());
            // `updated` is mandatory in Atom; prefer `published` when present.
            let ts = entry
                .published()
                .unwrap_or_else(|| entry.updated())
                .timestamp();
            Some((ts, NewsHeadline { title, url }))
        })
        .collect()
}

/// Parse an RSS `pubDate` (RFC 2822, e.g. `Mon, 01 Jan 2024 00:00:00 +0000`)
/// into a Unix timestamp, tolerating the occasional RFC 3339 feed.
fn parse_feed_timestamp(raw: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc2822(raw)
        .or_else(|_| chrono::DateTime::parse_from_rfc3339(raw))
        .ok()
        .map(|dt| dt.timestamp())
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
    fn parse_atom_feed_extracts_title_link_and_time() {
        // The Atom branch (dispatched when RSS parsing fails) must extract the
        // title, the first link's href, and the published timestamp.
        let atom = br#"<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example</title>
  <updated>2024-01-02T00:00:00Z</updated>
  <id>urn:example:feed</id>
  <entry>
    <title>Atom Headline</title>
    <link rel="alternate" href="https://example.com/a"/>
    <id>urn:example:a</id>
    <updated>2024-01-01T00:00:00Z</updated>
    <published>2024-01-02T00:00:00Z</published>
  </entry>
</feed>"#;
        let entries = parse_feed_entries_with_time(atom).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].1.title, "Atom Headline");
        assert_eq!(entries[0].1.url.as_deref(), Some("https://example.com/a"));
        // `published` (Jan 2) wins over `updated` (Jan 1).
        assert_eq!(
            entries[0].0,
            chrono::DateTime::parse_from_rfc3339("2024-01-02T00:00:00Z")
                .unwrap()
                .timestamp()
        );
    }

    #[test]
    fn parse_rss_falls_back_to_dublin_core_date() {
        // Feeds that carry <dc:date> instead of <pubDate> must still sort by time.
        let rss = br#"<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
  <item><title>DC Dated</title><dc:date>2024-03-04T05:06:07Z</dc:date></item>
</channel></rss>"#;
        let entries = parse_feed_entries_with_time(rss).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].0,
            chrono::DateTime::parse_from_rfc3339("2024-03-04T05:06:07Z")
                .unwrap()
                .timestamp()
        );
    }

    #[test]
    fn parse_atom_prefers_alternate_link() {
        // When an entry has both a self and an alternate link, use the alternate
        // one (the article URL), not whichever appears first.
        let atom = br#"<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example</title><updated>2024-01-02T00:00:00Z</updated><id>urn:f</id>
  <entry>
    <title>Linked</title><id>urn:e</id><updated>2024-01-02T00:00:00Z</updated>
    <link rel="self" href="https://example.com/self"/>
    <link rel="alternate" href="https://example.com/article"/>
  </entry>
</feed>"#;
        let entries = parse_feed_entries_with_time(atom).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].1.url.as_deref(),
            Some("https://example.com/article")
        );
    }

    #[test]
    fn parse_atom_skips_empty_title_entries() {
        // An Atom entry with an empty <title> must not surface a blank headline.
        let atom = br#"<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example</title><updated>2024-01-02T00:00:00Z</updated><id>urn:f</id>
  <entry><title></title><id>urn:e1</id><updated>2024-01-01T00:00:00Z</updated></entry>
  <entry><title>Real</title><id>urn:e2</id><updated>2024-01-02T00:00:00Z</updated></entry>
</feed>"#;
        let entries = parse_feed_entries_with_time(atom).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].1.title, "Real");
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
