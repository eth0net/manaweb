// The import runner with its one write held open, so a screen can be looked
// at while a keep is still going. Nothing else here fakes a module: this one
// is faked because a write is the state, and the real one has no pause in it.

import { mock } from "bun:test";
import type { State } from "../import/runner";

export type Writing = {
  // What the runner answers, once the test is done looking: a reason the
  // write failed, or null for one that landed.
  finish: (why?: string | null) => void;
  // How far along the import the screen is told it is.
  state: (at: State) => void;
};

export function writing(): Writing {
  let settle: ((why: string | null) => void) | null = null;
  let state: State = { at: "none" };

  mock.module("../import/runner", () => ({
    begin: () =>
      new Promise<string | null>((done) => {
        settle = done;
      }),
    useImport: () => state,
  }));

  return {
    finish: (why = null) => settle?.(why),
    state: (at) => {
      state = at;
    },
  };
}
