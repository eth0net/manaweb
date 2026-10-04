import { expect, test } from "bun:test";
import type { Owned, Stack } from "../collection/cards";
import { UNFILED } from "../collection/containers";
import { ALL, named, plain, within } from "./scope";

const BINDER = "at://x/app.manaweb.container/one";
const BOX = "at://x/app.manaweb.container/two";

function stack(container?: string): Stack {
  const value: Owned = {
    scryfallId: "d40c73de-7a5f-46f2-a70b-449bc8ecfe24",
    finish: "nonfoil",
    quantity: 1,
    createdAt: "2026-10-04T00:00:00.000Z",
    ...(container ? { container } : {}),
  };
  return { uri: `at://x/${container ?? "none"}`, cid: "", value };
}

const HELD = [stack(), stack(BINDER), stack(BOX), stack(BINDER)];

test("everything is every stack", () => {
  expect(within(HELD, ALL)).toHaveLength(4);
});

test("unfiled is what no container holds", () => {
  const found = within(HELD, UNFILED.key);
  expect(found).toHaveLength(1);
  expect(found[0]?.value.container).toBeUndefined();
});

test("a container is its own cards and nobody else's", () => {
  expect(within(HELD, BINDER)).toHaveLength(2);
  expect(within(HELD, BOX)).toHaveLength(1);
});

test("a container this account no longer has holds nothing", () => {
  expect(within(HELD, "at://x/gone")).toHaveLength(0);
});

test("unfiled and everything are not the same file", () => {
  const places = new Map([[BINDER, "Draft binder"]]);
  expect(plain(named(UNFILED.key, places))).not.toBe(
    plain(named(ALL, places)),
  );
});

test("a file is named after the place it came from", () => {
  const places = new Map([[BINDER, "Draft binder"]]);
  expect(plain(named(BINDER, places))).toBe("draft-binder");
  expect(plain(named(BOX, places))).toBe("cards");
});

test("a name a file system would refuse is one it takes", () => {
  expect(plain("Commander / EDH")).toBe("commander-edh");
  expect(plain("★★★")).toBe("cards");
});
