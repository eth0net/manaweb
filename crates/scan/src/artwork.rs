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
    /// Whether the illustration is on that printing's other side.
    pub back: bool,
}

impl Artwork {
    /// Where Scryfall serves the illustration alone, without the frame.
    #[must_use]
    pub fn art_crop(&self) -> String {
        let id = &self.print;
        let (a, b) = (&id[0..1], &id[1..2]);
        let face = if self.back { "back" } else { "front" };
        format!("https://cards.scryfall.io/art_crop/{face}/{a}/{b}/{id}.jpg")
    }
}

/// Every artwork a paper printing carries, either side, one representative
/// printing each.
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
        "WITH faces AS (
             SELECT illustration_id AS art, id, 0 AS back, image_status, seq
             FROM cards
             WHERE illustration_id IS NOT NULL AND NOT digital
             UNION ALL
             SELECT json_extract(card_faces, '$[1].illustration_id'),
                    id, 1, image_status, seq
             FROM cards
             WHERE NOT digital
               AND illustration_id IS NOT NULL
               AND json_extract(card_faces, '$[1].illustration_id') IS NOT NULL
               AND json_extract(card_faces, '$[1].illustration_id')
                   <> illustration_id
         )
         SELECT art AS id, id AS print, back FROM (
             SELECT art, id, back, row_number() OVER (
                 PARTITION BY art
                 ORDER BY CASE image_status
                              WHEN 'highres_scan' THEN 0
                              WHEN 'lowres' THEN 1
                              ELSE 2
                          END, back, seq
             ) AS rank
             FROM faces
         )
         WHERE rank = 1
         ORDER BY art",
    )
    .fetch_all(pool)
    .await?)
}
