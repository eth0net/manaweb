//! Finding a card in a frame, and reading it back as a rectangle.
//!
//! What this is for and what it replaces is `docs/roadmap.md`.

// Every cast here crosses between a pixel grid and the real numbers a
// gradient and a projection are worked out in.
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]

use crate::Frame;

/// A point in a frame, in pixels, and not necessarily on a whole one.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

/// The four corners of a card, clockwise from the top left of the card
/// itself rather than of the frame — so a card lying on its side names its
/// own top left, and rectifying it stands it back up.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Quad {
    pub corners: [Point; 4],
}

/// What a card measures, in millimeters.
const RATIO: f32 = 63.0 / 88.0;

/// How far from [`RATIO`] a quadrilateral may be and still be taken for a
/// card. Wide, because perspective foreshortens one axis and this is a
/// filter against walls and table edges rather than a measurement.
const RATIO_SLACK: f32 = 0.35;

/// How much of the frame a card has to cover to be the one meant. Below
/// this it is something in the background rather than what was pointed at.
const LEAST_AREA: f32 = 0.04;

impl Quad {
    /// Corners in the order [`Quad`] states, or `None` for a degenerate one.
    #[must_use]
    pub fn new(corners: [Point; 4]) -> Option<Self> {
        let held = Self { corners };
        (held.area() > 0.0).then_some(held)
    }

    /// The shoelace area, which is positive for the order stated and
    /// negative for the other way round.
    #[must_use]
    pub fn area(&self) -> f32 {
        let mut sum = 0.0;
        for at in 0..4 {
            let (a, b) = (self.corners[at], self.corners[(at + 1) % 4]);
            sum += a.x * b.y - b.x * a.y;
        }
        sum.abs() / 2.0
    }

    /// The longer and shorter of the mean opposing side lengths.
    #[must_use]
    pub fn sides(&self) -> (f32, f32) {
        let side = |a: Point, b: Point| ((b.x - a.x).powi(2) + (b.y - a.y).powi(2)).sqrt();
        let [tl, tr, br, bl] = self.corners;
        let across = f32::midpoint(side(tl, tr), side(bl, br));
        let down = f32::midpoint(side(tl, bl), side(tr, br));
        (across, down)
    }

    /// Whether this could be a card: shaped like one, and enough of what was
    /// being pointed at.
    #[must_use]
    pub fn card_like(&self, frame: &Frame) -> bool {
        let (across, down) = self.sides();
        if across <= 0.0 || down <= 0.0 {
            return false;
        }
        // Either way up, since a card on its side is still a card.
        let ratio = (across / down).min(down / across);
        let covering = self.area() / (frame.width() * frame.height()) as f32;
        (ratio - RATIO).abs() <= RATIO_SLACK && covering >= LEAST_AREA
    }
}

/// Longest side of the grid detection works over.
///
/// A card's edges are a low-frequency thing and the cost of looking for them
/// is the pixel count, so the frame is sampled down to this rather than read
/// whole. Big enough that a card covering a twenty-fifth of the frame is
/// still forty pixels across.
const GRID: usize = 192;

/// The frame sampled down to at most [`GRID`] on its longer side.
struct Small {
    levels: Vec<u8>,
    width: usize,
    height: usize,
    /// What multiplying a coordinate here by gives one in the frame.
    scale: f32,
}

impl Small {
    fn of(frame: &Frame) -> Option<Self> {
        let (w, h) = (frame.width(), frame.height());
        let scale = (w.max(h) as f32 / GRID as f32).max(1.0);
        let (width, height) = (
            ((w as f32 / scale) as usize).max(1),
            ((h as f32 / scale) as usize).max(1),
        );
        if width < 8 || height < 8 {
            return None;
        }

        let mut levels = vec![0u8; width * height];
        for y in 0..height {
            for x in 0..width {
                // Nearest rather than filtered: this decides which side of a
                // threshold a pixel falls, not what it looks like.
                levels[y * width + x] = frame.at(
                    ((x as f32 * scale) as usize).min(w - 1),
                    ((y as f32 * scale) as usize).min(h - 1),
                )?;
            }
        }
        Some(Self {
            levels,
            width,
            height,
            scale,
        })
    }

    /// The level that best splits the grid in two, by Otsu's method: the
    /// threshold putting the most variance between the halves.
    fn split(&self) -> u8 {
        let mut counts = [0usize; 256];
        for level in &self.levels {
            counts[*level as usize] += 1;
        }
        let total = self.levels.len() as f32;
        let whole: f32 = counts
            .iter()
            .enumerate()
            .map(|(level, count)| level as f32 * *count as f32)
            .sum();

        let (mut behind, mut sum, mut best, mut at) = (0f32, 0f32, -1f32, 0u8);
        for (level, count) in counts.iter().enumerate() {
            behind += *count as f32;
            if behind == 0.0 {
                continue;
            }
            let ahead = total - behind;
            if ahead == 0.0 {
                break;
            }
            sum += level as f32 * *count as f32;
            let between = behind * ahead * (sum / behind - (whole - sum) / ahead).powi(2);
            if between > best {
                best = between;
                at = level as u8;
            }
        }
        at
    }

    /// Whether the frame's own border is mostly above the threshold, which
    /// is what says which side of it the card is on.
    fn border_above(&self, at: u8) -> bool {
        let (mut above, mut seen) = (0usize, 0usize);
        for y in 0..self.height {
            for x in 0..self.width {
                let edge = x == 0 || y == 0 || x + 1 == self.width || y + 1 == self.height;
                if edge {
                    seen += 1;
                    above += usize::from(self.levels[y * self.width + x] > at);
                }
            }
        }
        above * 2 > seen
    }
}

/// The card in a frame, or `None` where nothing in it is shaped like one.
///
/// Thresholds the frame in two, takes the largest run of pixels on whichever
/// side its border is not, and reads the four corners off that run's hull.
#[must_use]
pub fn card(frame: &Frame) -> Option<Quad> {
    let small = Small::of(frame)?;
    let at = small.split();
    // The card is whichever side of the threshold the frame's edge is not,
    // so a black border on a white table and a white one on a dark mat are
    // the same problem.
    let wanted = !small.border_above(at);

    let inside: Vec<bool> = small
        .levels
        .iter()
        .map(|level| (*level > at) == wanted)
        .collect();
    let run = largest(&inside, small.width, small.height)?;
    let hull = hull(&run);
    let quad = widest(&hull)?;

    // Back to the frame's own pixels, the grid having been a way of looking
    // rather than what was being looked at.
    let corners = quad.map(|held| Point {
        x: held.x * small.scale,
        y: held.y * small.scale,
    });
    let found = Quad::new(clockwise(corners))?;
    found.card_like(frame).then_some(found)
}

/// Every pixel of the largest connected run of `inside`, four-connected.
fn largest(inside: &[bool], width: usize, height: usize) -> Option<Vec<Point>> {
    let mut seen = vec![false; inside.len()];
    let mut best: Vec<Point> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();

    for start in 0..inside.len() {
        if seen[start] || !inside[start] {
            continue;
        }
        let mut run: Vec<Point> = Vec::new();
        seen[start] = true;
        stack.push(start);

        while let Some(at) = stack.pop() {
            let (x, y) = (at % width, at / width);
            run.push(Point {
                x: x as f32,
                y: y as f32,
            });
            let mut step = |nx: usize, ny: usize| {
                let next = ny * width + nx;
                if !seen[next] && inside[next] {
                    seen[next] = true;
                    stack.push(next);
                }
            };
            if x > 0 {
                step(x - 1, y);
            }
            if x + 1 < width {
                step(x + 1, y);
            }
            if y > 0 {
                step(x, y - 1);
            }
            if y + 1 < height {
                step(x, y + 1);
            }
        }

        if run.len() > best.len() {
            best = run;
        }
    }

    (!best.is_empty()).then_some(best)
}

/// The convex hull of a run, by monotone chain.
fn hull(run: &[Point]) -> Vec<Point> {
    let mut points = run.to_vec();
    points.sort_by(|a, b| a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y)));
    // Whole pixels either way, so these are equal or they are different
    // points, and no tolerance would mean anything.
    points.dedup_by(|a, b| a.x.to_bits() == b.x.to_bits() && a.y.to_bits() == b.y.to_bits());
    if points.len() < 3 {
        return points;
    }

    let turn = |o: Point, a: Point, b: Point| (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    let mut out: Vec<Point> = Vec::with_capacity(points.len() * 2);
    for pass in 0..2 {
        let half = out.len();
        let ordered: Vec<Point> = if pass == 0 {
            points.clone()
        } else {
            points.iter().rev().copied().collect()
        };
        for point in ordered {
            while out.len() >= half + 2
                && turn(out[out.len() - 2], out[out.len() - 1], point) <= 0.0
            {
                out.pop();
            }
            out.push(point);
        }
        out.pop();
    }
    out
}

/// The four hull points enclosing the most area, which for a card's outline
/// is its corners.
///
/// Every diagonal is tried and the best third and fourth point found either
/// side of it — a hull of a few dozen points, so the work is nothing beside
/// the threshold that produced it.
fn widest(hull: &[Point]) -> Option<[Point; 4]> {
    if hull.len() < 4 {
        return None;
    }
    let triangle = |a: Point, b: Point, c: Point| {
        ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)).abs() / 2.0
    };

    let mut best = (0f32, [hull[0]; 4]);
    for first in 0..hull.len() {
        for third in (first + 2)..hull.len() {
            let mut second = (0f32, first);
            for at in (first + 1)..third {
                let area = triangle(hull[first], hull[at], hull[third]);
                if area > second.0 {
                    second = (area, at);
                }
            }
            let mut fourth = (0f32, first);
            for at in (third + 1)..hull.len() {
                let area = triangle(hull[first], hull[third], hull[at]);
                if area > fourth.0 {
                    fourth = (area, at);
                }
            }
            let whole = second.0 + fourth.0;
            if whole > best.0 && second.1 != first && fourth.1 != first {
                best = (
                    whole,
                    [hull[first], hull[second.1], hull[third], hull[fourth.1]],
                );
            }
        }
    }

    (best.0 > 0.0).then_some(best.1)
}

/// The same four corners wound clockwise from the one nearest the frame's
/// own origin.
///
/// Which of them is the card's top is a different question, and one nothing
/// answers yet — see `docs/roadmap.md`.
fn clockwise(corners: [Point; 4]) -> [Point; 4] {
    let mid = Point {
        x: corners.iter().map(|at| at.x).sum::<f32>() / 4.0,
        y: corners.iter().map(|at| at.y).sum::<f32>() / 4.0,
    };
    let mut held = corners;
    held.sort_by(|a, b| {
        let angle = |at: &Point| libm::atan2f(at.y - mid.y, at.x - mid.x);
        angle(a).total_cmp(&angle(b))
    });

    let nearest = held
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| (a.x + a.y).total_cmp(&(b.x + b.y)))
        .map_or(0, |(at, _)| at);
    std::array::from_fn(|at| held[(nearest + at) % 4])
}
