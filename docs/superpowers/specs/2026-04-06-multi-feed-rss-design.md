# Multi-Feed RSS Support for Morning Briefing

**Date:** 2026-04-06
**Status:** Implemented

## Context

The morning briefing news card previously supported a single `news_feed_url` (disabled by default). For the developer build, three feeds were chosen — XKCD, Hacker News, and Wikipedia Featured Articles — which required extending the backend to aggregate multiple RSS/Atom feeds and surface the freshest headlines regardless of source.

There are no real users yet; the three feeds are a dev fixture and will be replaced before launch. A known limitation: per-feed fetch errors are not surfaced to users, so broken feeds silently disappear from the headline list. See the tracking issue for future work.

## Architecture

### Config Layer

`ExternalProvidersConfig.news_feed_urls: Vec<String>` (previously `news_feed_url: String`).

TOML format:
```toml
[external_providers]
news_feed_urls = [
  "https://xkcd.com/rss.xml",
  "https://news.ycombinator.com/rss",
  "https://en.wikipedia.org/w/api.php?action=featuredfeed&feed=featured&feedformat=atom",
]
```

Empty list disables news. Env var override: `APP_EXTERNAL_PROVIDERS__NEWS_FEED_URLS__0=...` (config crate indexed array syntax).

### Provider Layer

`RssFeedProvider::new(feed_urls: &[String])` — takes a slice of URLs.

On each cache miss:
1. Fetch all URLs **concurrently** via `futures::join_all`
2. For each successful response, parse with `feed-rs` into `(unix_timestamp, NewsHeadline)` pairs
3. Failed feeds are logged at `warn` level and skipped
4. Merge all entries, sort descending by publish timestamp
5. Take first N (currently 3) → return `Vec<NewsHeadline>`

Entries without a publish or update date fall back to Unix epoch (timestamp `0`), sorting them to the bottom of the merged list. This treats undated content as potentially stale rather than assuming it is fresh.

### Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Single feed fails | Log `warn`, skip, use remaining feeds |
| All feeds fail | Return `503` |
| Empty feed (0 entries) | Not an error; contributes nothing |
| Empty `news_feed_urls` | Return `Ok(vec![])` immediately |

### Cache

Unchanged: 30-minute TTL, keyed by rounded location `"{lat:.1},{lon:.1}"`. News content does not vary by location; the location key is preserved for future per-region feed selection.

## Dev Feed Outcome

With three feeds sorted by publish time, the typical daily result:
- 1–2 Hacker News stories (publishes constantly)
- Wikipedia featured article (1/day)
- XKCD on Mon/Wed/Fri when it publishes

## Known Limitation

Per-feed fetch errors are not surfaced to users, so permanently broken feeds silently produce zero results without any way for users to identify and remove them. Tracked in a GitHub issue.
