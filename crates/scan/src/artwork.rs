//! The artworks an index covers, and where each one's image is.

use sqlx::SqlitePool;

use crate::Result;

/// One artwork, and the printing whose image stands for it.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Artwork {
    /// Scryfall's `illustration_id`. Stable across printings and across a
    /// rebuild, which the catalog's own art number is not.
    pub id: String,
    /// The printing the image URL is derived from.
    pub print: String,
}

impl Artwork {
    /// Where Scryfall serves the illustration alone, without the frame.
    #[must_use]
    pub fn art_crop(&self) -> String {
        let id = &self.print;
        let (a, b) = (&id[0..1], &id[1..2]);
        format!("https://cards.scryfall.io/art_crop/front/{a}/{b}/{id}.jpg")
    }
}

/// Every artwork a paper printing carries, one representative printing each.
///
/// Digital-only artworks are left out because the catalog leaves their
/// printings out, so nothing the client could match against would name one.
///
/// # Errors
///
/// Fails on a database error.
pub async fn all(pool: &SqlitePool) -> Result<Vec<Artwork>> {
    // The best image wins the group, because a placeholder has nothing behind
    // its URL and a low-resolution scan hashes to something the real one does
    // not. Ordered by id so two machines enumerate the same way.
    Ok(sqlx::query_as(
        "SELECT illustration_id AS id, id AS print FROM (
             SELECT illustration_id, id, row_number() OVER (
                 PARTITION BY illustration_id
                 ORDER BY CASE image_status
                              WHEN 'highres_scan' THEN 0
                              WHEN 'lowres' THEN 1
                              ELSE 2
                          END, seq
             ) AS rank
             FROM cards
             WHERE illustration_id IS NOT NULL AND NOT digital
         )
         WHERE rank = 1
         ORDER BY illustration_id",
    )
    .fetch_all(pool)
    .await?)
}
