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

/// The four corners of a card, clockwise from one end of a short side, so
/// that rectifying one stands it portrait whichever way round it lay.
///
/// Which end of that side is the card's top is a different question, and one
/// nothing answers yet — see `docs/roadmap.md`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Quad {
    pub corners: [Point; 4],
}

/// What a card measures, in millimeters.
pub const RATIO: f32 = 63.0 / 88.0;

/// How far from [`RATIO`] a quadrilateral may be and still be taken for a
/// card. Wide, because perspective foreshortens one axis and this is a
/// filter against walls and table edges rather than a measurement.
const RATIO_SLACK: f32 = 0.35;

/// How much of the frame a card has to cover to be the one meant. Below
/// this it is something in the background rather than what was pointed at.
const LEAST_AREA: f32 = 0.04;

/// How much of an outline's own hull its four corners have to enclose.
///
/// A card's outline is four straight edges, so its hull is a quadrilateral
/// and this is nearly one. A bright patch of artwork is not, and four
/// corners fitted inside that leave the rest of it outside.
const LEAST_FILL: f32 = 0.92;

impl Quad {
    /// Corners in the order [`Quad`] states, or `None` for a degenerate one.
    #[must_use]
    pub fn new(corners: [Point; 4]) -> Option<Self> {
        let held = Self { corners };
        (held.area() > 0.0).then_some(held)
    }

    /// What the four corners enclose, whichever way round they are wound.
    #[must_use]
    pub fn area(&self) -> f32 {
        enclosed(&self.corners)
    }

    /// The same card, taken to be the other way up.
    ///
    /// Which end of a short side is the card's top is not known, so a reader
    /// asks both rather than betting on one.
    #[must_use]
    pub fn turned(&self) -> Self {
        Self {
            corners: std::array::from_fn(|at| self.corners[(at + 2) % 4]),
        }
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
                // Nearest rather than filtered: a step between neighbors is
                // what this is read for, and filtering softens one.
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

    /// Everything reachable from the frame's own edge without stepping over
    /// [`STEP`], which is the table the card is lying on.
    ///
    /// What this reads that a level could not is `docs/roadmap.md`.
    fn outside(&self) -> Vec<bool> {
        let mut seen = vec![false; self.levels.len()];
        let mut stack: Vec<usize> = Vec::new();
        for y in 0..self.height {
            for x in 0..self.width {
                if x == 0 || y == 0 || x + 1 == self.width || y + 1 == self.height {
                    let at = y * self.width + x;
                    seen[at] = true;
                    stack.push(at);
                }
            }
        }

        while let Some(at) = stack.pop() {
            let (x, y) = (at % self.width, at / self.width);
            let level = self.levels[at];
            let mut step = |nx: usize, ny: usize, stack: &mut Vec<usize>| {
                let next = ny * self.width + nx;
                if !seen[next] && self.levels[next].abs_diff(level) <= STEP {
                    seen[next] = true;
                    stack.push(next);
                }
            };
            if x > 0 {
                step(x - 1, y, &mut stack);
            }
            if x + 1 < self.width {
                step(x + 1, y, &mut stack);
            }
            if y > 0 {
                step(x, y - 1, &mut stack);
            }
            if y + 1 < self.height {
                step(x, y + 1, &mut stack);
            }
        }
        seen
    }
}

/// How much of a frame has to be the surface a card is lying on.
///
/// Below this nothing was flooded, so the frame is a picture of a card
/// rather than a photograph of one and whatever was found is inside it: the
/// art box of an ordinary card is a card's own proportions to within a
/// hundredth, and passes every other check here.
const LEAST_TABLE: f32 = 0.25;

/// The level difference between neighbors that stops the flood. Below it is
/// shading across a surface, above it is one thing ending and another
/// starting.
const STEP: u8 = 10;

/// The card in a frame, or `None` where nothing in it is shaped like one.
#[must_use]
pub fn card(frame: &Frame) -> Option<Quad> {
    let small = Small::of(frame)?;
    // Whatever the flood could not reach, which is the card and anything else
    // standing off the surface — no assumption about which is the brighter.
    let outside = small.outside();
    let table = outside.iter().filter(|held| **held).count() as f32 / outside.len() as f32;
    if table < LEAST_TABLE {
        return None;
    }

    let inside: Vec<bool> = outside.iter().map(|held| !held).collect();
    let run = largest(&inside, small.width, small.height)?;
    let hull = hull(&run);
    let held = Quad::new(upright(clockwise(widest(&hull)?)))?;
    if held.area() < enclosed(&hull) * LEAST_FILL {
        return None;
    }

    // Back to the frame's own pixels, the grid having been a way of looking
    // rather than what was being looked at.
    let found = Quad {
        corners: held.corners.map(|at| Point {
            x: at.x * small.scale,
            y: at.y * small.scale,
        }),
    };
    found.card_like(frame).then_some(found)
}

/// The area a closed run of points encloses, by the shoelace formula.
fn enclosed(points: &[Point]) -> f32 {
    let mut sum = 0.0;
    for at in 0..points.len() {
        let (a, b) = (points[at], points[(at + 1) % points.len()]);
        sum += a.x * b.y - b.x * a.y;
    }
    sum.abs() / 2.0
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

/// The same winding, started at whichever corner leaves the short side first.
fn upright(corners: [Point; 4]) -> [Point; 4] {
    let (across, down) = Quad { corners }.sides();
    if across <= down {
        return corners;
    }
    std::array::from_fn(|at| corners[(at + 1) % 4])
}

/// A card read back as a rectangle of its own proportions, owning its levels.
#[derive(Debug)]
pub struct Card {
    levels: Vec<u8>,
    width: usize,
    height: usize,
}

impl Card {
    /// The card as the hashing reads it.
    #[must_use]
    pub fn frame(&self) -> Option<Frame<'_>> {
        Frame::new(&self.levels, self.width, self.height, self.width)
    }
}

/// The tallest a card is read back at. Past here the extra pixels reach no
/// finer than the hashing's own grid does.
const TALL: usize = 1024;

/// The shortest, so a card far enough away to be a smear is still a picture.
const SHORT: usize = 64;

/// The card standing upright, its foreshortening undone.
///
/// The quadrilateral is taken for a rectangle seen in perspective, so what
/// reads it back is the projection carrying one to the other rather than a
/// stretch: the edge nearer the camera covers more of the frame than the one
/// opposite, and a stretch would keep that difference.
#[must_use]
pub fn rectify(frame: &Frame, quad: &Quad) -> Option<Card> {
    let (_, down) = quad.sides();
    let height = (down.round() as usize).clamp(SHORT, TALL);
    let width = ((height as f32 * RATIO).round() as usize).max(SHORT / 2);
    let projection = Projection::of(&quad.corners)?;

    let mut levels = vec![0u8; width * height];
    for (y, row) in levels.chunks_exact_mut(width).enumerate() {
        let down = (y as f32 + 0.5) / height as f32;
        for (x, held) in row.iter_mut().enumerate() {
            let across = (x as f32 + 0.5) / width as f32;
            let (at_x, at_y) = projection.at(across, down)?;
            *held = level(frame, at_x, at_y);
        }
    }

    Some(Card {
        levels,
        width,
        height,
    })
}

/// The projection carrying the unit square's corners to four points.
///
/// Closed form because the source is a square: [`Projection::skew`] is what
/// an affine map has no room for, and it falls out of the diagonal.
struct Projection {
    /// A row each for `x` and `y`, read against `u`, `v` and 1.
    rows: [[f32; 3]; 2],
    /// The divisor those two are over, read against `u` and `v`, plus 1.
    skew: [f32; 2],
}

impl Projection {
    fn of(corners: &[Point; 4]) -> Option<Self> {
        let [first, second, third, fourth] = *corners;
        let slip = [
            first.x - second.x + third.x - fourth.x,
            first.y - second.y + third.y - fourth.y,
        ];

        // Opposite edges already parallel: nothing is foreshortened, and the
        // divisor below would be solving for two zeroes.
        if slip.iter().all(|term| term.abs() < f32::EPSILON) {
            return Some(Self {
                rows: [
                    [second.x - first.x, fourth.x - first.x, first.x],
                    [second.y - first.y, fourth.y - first.y, first.y],
                ],
                skew: [0.0, 0.0],
            });
        }

        let one = [second.x - third.x, second.y - third.y];
        let other = [fourth.x - third.x, fourth.y - third.y];
        let den = one[0] * other[1] - other[0] * one[1];
        if den.abs() < f32::EPSILON {
            return None;
        }
        let skew = [
            (slip[0] * other[1] - other[0] * slip[1]) / den,
            (one[0] * slip[1] - slip[0] * one[1]) / den,
        ];

        Some(Self {
            rows: [
                [
                    skew[0].mul_add(second.x, second.x - first.x),
                    skew[1].mul_add(fourth.x, fourth.x - first.x),
                    first.x,
                ],
                [
                    skew[0].mul_add(second.y, second.y - first.y),
                    skew[1].mul_add(fourth.y, fourth.y - first.y),
                    first.y,
                ],
            ],
            skew,
        })
    }

    /// Where one point of the unit square lands in the frame.
    fn at(&self, across: f32, down: f32) -> Option<(f32, f32)> {
        let divisor = self.skew[0].mul_add(across, self.skew[1] * down) + 1.0;
        if divisor.abs() < f32::EPSILON {
            return None;
        }
        let along = |row: &[f32; 3]| (row[0].mul_add(across, row[1] * down) + row[2]) / divisor;
        Some((along(&self.rows[0]), along(&self.rows[1])))
    }
}

/// One point of the frame, between pixels, and the nearest edge past one.
fn level(frame: &Frame, x: f32, y: f32) -> u8 {
    let (last_x, last_y) = (frame.width() - 1, frame.height() - 1);
    let x = x.clamp(0.0, last_x as f32);
    let y = y.clamp(0.0, last_y as f32);
    let (x0, y0) = (x as usize, y as usize);
    let (x1, y1) = ((x0 + 1).min(last_x), (y0 + 1).min(last_y));
    let (fx, fy) = (x - x0 as f32, y - y0 as f32);

    let at = |x, y| f32::from(frame.at(x, y).unwrap_or(0));
    let across = |y| (at(x1, y) - at(x0, y)).mul_add(fx, at(x0, y));
    let (top, bottom) = (across(y0), across(y1));
    (bottom - top).mul_add(fy, top).round().clamp(0.0, 255.0) as u8
}
