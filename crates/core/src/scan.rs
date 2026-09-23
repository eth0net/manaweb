//! The artwork hash store, which the export reads in place of the images.
//!
//! Turning one illustration into hashes means fetching and decoding a JPEG,
//! and there are fifty thousand of them, so `manaweb-scan` does that on a
//! workstation and leaves this behind. The server fetches the result like any
//! other input and never opens an image.

use std::collections::BTreeMap;

use crate::{Error, Result};

/// Hashes an artwork carries: the same illustration at each inset the scanner
/// indexes, so a photograph framed a little wide still lands on it.
pub const HASHES: usize = 4;

/// Scryfall's `illustration_id`, raw rather than the 36 characters it prints
/// as.
const KEY: usize = 16;

const MAGIC: [u8; 6] = *b"MWSCAN";
const VERSION: u8 = 1;
const HEADER: usize = MAGIC.len() + 2;
const ENTRY: usize = KEY + HASHES * 8;

/// Every artwork hashed so far, by illustration.
///
/// Ordered, so two runs over the same artworks write identical bytes and a
/// re-upload of an unchanged store moves nothing.
#[derive(Debug, Default, Clone)]
pub struct Store(BTreeMap<[u8; KEY], [u64; HASHES]>);

impl Store {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, id: [u8; KEY], hashes: [u64; HASHES]) {
        self.0.insert(id, hashes);
    }

    #[must_use]
    pub fn get(&self, id: &[u8; KEY]) -> Option<[u64; HASHES]> {
        self.0.get(id).copied()
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.0.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Parses a store.
    ///
    /// # Errors
    ///
    /// Fails on anything this build would otherwise read as hashes: a header
    /// it does not recognize, a different count per artwork, or a trailing
    /// entry cut short.
    pub fn read(bytes: &[u8]) -> Result<Self> {
        let header = bytes.get(..HEADER).ok_or(Error::Scan("no header"))?;
        if header[..MAGIC.len()] != MAGIC {
            return Err(Error::Scan("not a hash store"));
        }
        if header[MAGIC.len()] != VERSION {
            return Err(Error::Scan("a format version this build does not read"));
        }
        if usize::from(header[MAGIC.len() + 1]) != HASHES {
            return Err(Error::Scan("a different number of hashes per artwork"));
        }

        let rest = &bytes[HEADER..];
        if !rest.len().is_multiple_of(ENTRY) {
            return Err(Error::Scan("an entry is cut short"));
        }

        let mut held = BTreeMap::new();
        for entry in rest.as_chunks::<ENTRY>().0 {
            let Some((id, words)) = entry.split_first_chunk::<KEY>() else {
                continue;
            };
            let mut hashes = [0u64; HASHES];
            for (hash, word) in hashes.iter_mut().zip(words.as_chunks::<8>().0) {
                *hash = u64::from_le_bytes(*word);
            }
            held.insert(*id, hashes);
        }

        Ok(Self(held))
    }

    #[must_use]
    pub fn write(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(HEADER + self.0.len() * ENTRY);
        out.extend_from_slice(&MAGIC);
        out.push(VERSION);
        out.push(u8::try_from(HASHES).unwrap_or(u8::MAX));
        for (id, hashes) in &self.0 {
            out.extend_from_slice(id);
            for hash in hashes {
                out.extend_from_slice(&hash.to_le_bytes());
            }
        }
        out
    }
}

/// Reads a UUID as the bytes it stands for, hyphenated or not.
#[must_use]
pub fn uuid(text: &str) -> Option<[u8; KEY]> {
    let mut out = [0u8; KEY];
    let mut digits = text.bytes().filter(|byte| *byte != b'-');

    for byte in &mut out {
        let (high, low) = (digits.next()?, digits.next()?);
        *byte = (nibble(high)? << 4) | nibble(low)?;
    }

    digits.next().is_none().then_some(out)
}

fn nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}
