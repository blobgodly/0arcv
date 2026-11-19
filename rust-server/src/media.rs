use std::time::Duration;
use reqwest::Client;
use serde_json::Value;
use tracing::warn;

use crate::models::{ImdbCandidate, MediaDetails, MediaKind};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const FALLBACK_MOVIE_POSTER: &str = "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800&auto=format&fit=crop&q=80";
const FALLBACK_SERIES_POSTER: &str = "https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?w=800&auto=format&fit=crop&q=80";
const FALLBACK_ANIME_POSTER: &str = "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800&auto=format&fit=crop&q=80";

pub struct MediaResolver {
    client: Client,
    tmdb_key: Option<String>,
}

impl MediaResolver {
    pub fn new(tmdb_key: Option<String>) -> Self {
        let client = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_else(|_| Client::new());

        Self { client, tmdb_key }
    }

    pub async fn search_imdb(&self, query: &str, requested_type: Option<&str>) -> Vec<ImdbCandidate> {
        let clean: String = query
            .trim()
            .to_lowercase()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .collect();

        if clean.is_empty() {
            return Vec::new();
        }

        let url = format!("https://v3.sg.media-imdb.com/suggestion/x/{}.json", clean);
        let Ok(res) = self.client.get(&url).send().await else {
            return Vec::new();
        };

        let Ok(data) = res.json::<Value>().await else {
            return Vec::new();
        };

        let Some(items) = data.get("d").and_then(|v| v.as_array()) else {
            return Vec::new();
        };

        items
            .iter()
            .filter_map(|item| {
                let id = item.get("id")?.as_str()?.to_string();
                if !id.starts_with("tt") {
                    return None;
                }

                let title = item.get("l")
                    .and_then(|v| v.as_str())
                    .unwrap_or(query)
                    .to_string();

                let year = item.get("y").and_then(|v| v.as_i64()).map(|y| y as i32);
                let raw_type = item.get("q")
                    .or_else(|| item.get("qid"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let poster_url = item.get("i")
                    .and_then(|i| i.get("imageUrl"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let stars = item.get("s")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let kind = map_imdb_type(raw_type.as_deref(), &title, requested_type);

                Some(ImdbCandidate {
                    id,
                    title,
                    year,
                    kind,
                    raw_type,
                    poster_url,
                    stars,
                })
            })
            .take(8)
            .collect()
    }

    pub async fn resolve_media_details(
        &self,
        mut title: String,
        year: Option<i32>,
        kind: MediaKind,
        existing_poster: Option<String>,
    ) -> MediaDetails {
        let mut description = String::new();
        let mut rating = 8.5;
        let mut genre = default_genre(kind).to_string();
        let mut poster_url = existing_poster;
        let mut release_year = year.unwrap_or_else(|| chrono::Utc::now().date_naive().year());
        let progress_total = if kind == MediaKind::Movie { None } else { Some(12) };

        // 1. TMDB Lookup if configured
        if let Some(ref tmdb_key) = self.tmdb_key {
            if kind != MediaKind::Anime {
                if let Some((t_title, t_year, t_desc, t_genre, t_rating, t_poster)) =
                    self.lookup_tmdb(tmdb_key, &title, kind).await
                {
                    title = t_title;
                    if year.is_none() {
                        release_year = t_year;
                    }
                    description = t_desc;
                    if !t_genre.is_empty() {
                        genre = t_genre;
                    }
                    if t_rating > 0.0 {
                        rating = t_rating;
                    }
                    if poster_url.is_none() {
                        poster_url = t_poster;
                    }
                }
            }
        }

        // 2. TVMaze fallback for Series / Anime
        if (kind == MediaKind::Series || kind == MediaKind::Anime)
            && description.is_empty()
            && poster_url.is_none()
        {
            if let Some((tv_desc, tv_rating, tv_genre, tv_poster, tv_year)) =
                self.lookup_tvmaze(&title).await
            {
                description = tv_desc;
                if let Some(r) = tv_rating {
                    rating = r;
                }
                if let Some(g) = tv_genre {
                    genre = g;
                }
                if poster_url.is_none() {
                    poster_url = tv_poster;
                }
                if year.is_none() {
                    if let Some(y) = tv_year {
                        release_year = y;
                    }
                }
            }
        }

        // 3. Wikipedia fallback
        if description.is_empty() {
            let variations = vec![
                format!("{}_({})", title.replace(' ', "_"), match kind {
                    MediaKind::Anime => "anime",
                    MediaKind::Series => "TV_series",
                    MediaKind::Movie => "film",
                }),
                title.replace(' ', "_"),
            ];

            for var in variations {
                if let Some((wiki_desc, wiki_poster)) = self.lookup_wikipedia(&var).await {
                    description = wiki_desc;
                    if poster_url.is_none() {
                        poster_url = wiki_poster;
                    }
                    break;
                }
            }
        }

        let fallback_poster = match kind {
            MediaKind::Movie => FALLBACK_MOVIE_POSTER,
            MediaKind::Series => FALLBACK_SERIES_POSTER,
            MediaKind::Anime => FALLBACK_ANIME_POSTER,
        };

        MediaDetails {
            title: title.clone(),
            kind,
            description: if !description.is_empty() {
                description
            } else {
                format!("An acclaimed {} saved to your watchlist.", kind.as_str())
            },
            genre,
            release_year,
            rating: rating.clamp(1.0, 10.0),
            poster_url: poster_url
                .filter(|u| u.starts_with("http"))
                .unwrap_or_else(|| fallback_poster.to_string()),
            progress_total,
        }
    }

    async fn lookup_tmdb(
        &self,
        key: &str,
        query: &str,
        kind: MediaKind,
    ) -> Option<(String, i32, String, String, f64, Option<String>)> {
        let search_url = format!(
            "https://api.themoviedb.org/3/search/multi?api_key={}&query={}&language=en-US&include_adult=false&page=1",
            urlencoding::encode(key),
            urlencoding::encode(query)
        );

        let res = self.client.get(&search_url).send().await.ok()?;
        let data = res.json::<Value>().await.ok()?;
        let results = data.get("results")?.as_array()?;

        let best = results.iter().find(|item| {
            item.get("overview").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false)
        }).or_else(|| results.first())?;

        let id = best.get("id")?.as_i64()?;
        let path = if kind == MediaKind::Series {
            format!("/3/tv/{}", id)
        } else {
            format!("/3/movie/{}", id)
        };

        let details_url = format!(
            "https://api.themoviedb.org{}?api_key={}&language=en-US",
            path,
            urlencoding::encode(key)
        );

        let d_res = self.client.get(&details_url).send().await.ok()?;
        let details = d_res.json::<Value>().await.ok()?;

        let title = details.get("title")
            .or_else(|| details.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or(query)
            .to_string();

        let date_str = details.get("release_date")
            .or_else(|| details.get("first_air_date"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let year = date_str.get(..4).and_then(|y| y.parse::<i32>().ok()).unwrap_or(2026);
        let overview = details.get("overview").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();

        let genres: Vec<String> = details.get("genres")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|g| g.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let genre = genres.join(", ");
        let rating = details.get("vote_average").and_then(|v| v.as_f64()).unwrap_or(8.5);

        let poster = details.get("poster_path")
            .and_then(|v| v.as_str())
            .map(|p| format!("https://image.tmdb.org/t/p/w500{}", p));

        Some((title, year, overview, genre, rating, poster))
    }

    async fn lookup_tvmaze(
        &self,
        query: &str,
    ) -> Option<(String, Option<f64>, Option<String>, Option<String>, Option<i32>)> {
        let url = format!(
            "https://api.tvmaze.com/singlesearch/shows?q={}",
            urlencoding::encode(query)
        );

        let res = self.client.get(&url).send().await.ok()?;
        if !res.status().is_success() {
            return None;
        }

        let data = res.json::<Value>().await.ok()?;
        let summary_raw = data.get("summary").and_then(|v| v.as_str())?;
        // Strip basic HTML tags
        let mut in_tag = false;
        let mut summary = String::new();
        for c in summary_raw.chars() {
            if c == '<' {
                in_tag = true;
            } else if c == '>' {
                in_tag = false;
            } else if !in_tag {
                summary.push(c);
            }
        }
        let summary = summary.trim().to_string();

        let rating = data.get("rating")
            .and_then(|r| r.get("average"))
            .and_then(|v| v.as_f64());

        let genres = data.get("genres")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|g| g.as_str().map(|s| s.to_string()))
                    .collect::<Vec<_>>()
                    .join(", ")
            });

        let poster = data.get("image")
            .and_then(|i| i.get("original"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let year = data.get("premiered")
            .and_then(|v| v.as_str())
            .and_then(|p| p.get(..4))
            .and_then(|y| y.parse::<i32>().ok());

        Some((summary, rating, genres, poster, year))
    }

    async fn lookup_wikipedia(&self, term: &str) -> Option<(String, Option<String>)> {
        let url = format!(
            "https://en.wikipedia.org/api/rest_v1/page/summary/{}",
            urlencoding::encode(term)
        );

        let res = self.client.get(&url).send().await.ok()?;
        if !res.status().is_success() {
            return None;
        }

        let data = res.json::<Value>().await.ok()?;
        let extract = data.get("extract").and_then(|v| v.as_str())?;
        if extract.contains("may refer to:") {
            return None;
        }

        let poster = data.get("originalimage")
            .or_else(|| data.get("thumbnail"))
            .and_then(|img| img.get("source"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Some((extract.to_string(), poster))
    }

    pub async fn lookup_media(&self, title: &str, requested_type: Option<&str>) -> MediaDetails {
        let kind = match requested_type {
            Some("series") => MediaKind::Series,
            Some("anime") => MediaKind::Anime,
            _ => MediaKind::Movie,
        };

        let candidates = self.search_imdb(title, requested_type).await;
        if let Some(top) = candidates.into_iter().next() {
            self.resolve_media_details(top.title, top.year, top.kind, top.poster_url).await
        } else {
            self.resolve_media_details(title.to_string(), None, kind, None).await
        }
    }
}

fn default_genre(kind: MediaKind) -> &'static str {
    match kind {
        MediaKind::Movie | MediaKind::Series => "Drama",
        MediaKind::Anime => "Animation",
    }
}

fn map_imdb_type(raw_type: Option<&str>, title: &str, requested_type: Option<&str>) -> MediaKind {
    let raw = raw_type.unwrap_or("").to_lowercase();
    let title_lower = title.to_lowercase();

    if raw.contains("series") || raw.contains("tv") || raw.contains("mini") {
        if requested_type == Some("anime") || title_lower.contains("anime") {
            return MediaKind::Anime;
        }
        return MediaKind::Series;
    }

    if requested_type == Some("anime") {
        MediaKind::Anime
    } else {
        MediaKind::Movie
    }
}

mod urlencoding {
    pub fn encode(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        for byte in s.bytes() {
            match byte {
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    out.push(byte as char);
                }
                _ => {
                    out.push_str(&format!("%{:02X}", byte));
                }
            }
        }
        out
    }
}
