import { describe, expect, test } from "bun:test";
import { energy, quantile, summarize, type Timing } from "./bench";

function timing(total: number, detected: boolean): Timing {
  return {
    frame: 1,
    draw: 0.4,
    readback: 0.6,
    luma: 2,
    query: total - 4,
    retrieve: 1,
    total,
    detected,
    margin: detected ? 6 : 0,
    sure: detected,
  };
}

describe("what a run is reported as", () => {
  test("takes a quantile by nearest rank", () => {
    const of = [10, 20, 30, 40];
    expect(quantile(of, 0.5)).toBe(20);
    expect(quantile(of, 0.9)).toBe(40);
    expect(quantile([7], 0.5)).toBe(7);
  });

  test("keeps the two cases apart", () => {
    const tally = summarize(
      [
        timing(10, true),
        timing(30, false),
        timing(34, false),
        timing(40, false),
      ],
      4000,
    );
    expect(tally?.found).toBe(10);
    expect(tally?.guessed).toBe(34);
    expect(tally?.detected).toBe(1);
    expect(tally?.fps).toBe(1);
  });

  // The grab is reported whole and in halves, which is what says whether the
  // readback is the thing to cut.
  test("keeps the two halves of a grab apart", () => {
    const tally = summarize([timing(10, true), timing(30, false)], 1000);
    expect(tally?.stages.draw).toBe(0.4);
    expect(tally?.stages.readback).toBe(0.6);
  });

  test("has nothing to say about no frames", () => {
    expect(summarize([], 1000)).toBeNull();
  });
});

describe("gradient energy", () => {
  const WIDE = 64;

  function plane(period: number): Uint8Array {
    const held = new Uint8Array(WIDE * WIDE);
    for (let at = 0; at < held.length; at++) {
      held[at] = Math.floor(128 + 100 * Math.sin((at % WIDE) / period));
    }
    return held;
  }

  test("is lower for a softer picture of the same size", () => {
    const sharp = energy(plane(1), WIDE, WIDE);
    const soft = energy(plane(8), WIDE, WIDE);
    expect(soft).toBeLessThan(sharp);
  });

  test("is nothing at all in a flat frame", () => {
    expect(energy(new Uint8Array(WIDE * WIDE).fill(90), WIDE, WIDE)).toBe(0);
  });
});
