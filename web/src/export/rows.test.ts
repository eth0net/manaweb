import { expect, test } from "bun:test";
import type { Owned, Stack } from "../collection/cards";
import { parse } from "../import/csv";
import { columns, MANABOX } from "../import/formats";
import { read } from "../import/read";
import { write } from "./csv";
import { type Describe, type Printing, rows } from "./rows";

const NOW = "2026-10-04T00:00:00.000Z";

const FIXTURES = ["manabox-binder", "manabox-collection", "manabox-list"];

// By name rather than by position: ManaBox has added a column before now.
const COLUMN = Object.fromEntries(
  columns(MANABOX).map((one, at) => [one, at]),
) as Record<string, number>;
const QUANTITY = COLUMN.Quantity as number;
const PRICE = COLUMN["Purchase price"] as number;
const CURRENCY = COLUMN["Purchase price currency"] as number;
const THEIR_ID = COLUMN["ManaBox ID"] as number;
const NAME = COLUMN.Name as number;
const FINISH = COLUMN.Foil as number;
const SCRYFALL = COLUMN["Scryfall ID"] as number;

async function fixture(name: string): Promise<string> {
  const at = new URL(`../import/fixtures/${name}.csv`, import.meta.url);
  return await Bun.file(at).text();
}

// Stacks as a set, for a comparison a deliberate reordering must not fail.
function ordered(owned: Owned[]): string[] {
  return owned.map((one) => JSON.stringify(one)).sort();
}

// A repo holds records rather than rows, and only `value` reaches a file.
function stacks(owned: Owned[]): Stack[] {
  return owned.map((value, at) => ({ uri: `at://x/${at}`, cid: "", value }));
}

// The catalog as the file itself describes it, so a round trip needs nothing
// fetched. The columns this fills are ones no import reads back.
function describing(text: string): Describe {
  const [head = [], ...body] = parse(text);
  const at = (name: string) => head.indexOf(name);
  const held = new Map<string, Printing>(
    body.map((row) => [
      (row[at("Scryfall ID")] ?? "").toLowerCase(),
      {
        card: { name: row[at("Name")] ?? "" },
        print: {
          set: (row[at("Set code")] ?? "").toLowerCase(),
          setName: row[at("Set name")] ?? "",
          collectorNumber: row[at("Collector number")] ?? "",
          rarity: row[at("Rarity")] ?? "",
          lang: row[at("Language")] ?? "",
        },
      },
    ]),
  );
  return (ids) =>
    new Map(
      [...ids].flatMap((id) => {
        const one = held.get(id);
        return one ? [[id, one] as const] : [];
      }),
    );
}

test.each(FIXTURES)("%s survives a round trip", async (name) => {
  const text = await fixture(name);
  const first = read(text, MANABOX, NOW);
  expect(first.skipped).toEqual([]);

  const out = write(
    rows(stacks(first.stacks), MANABOX, describing(text)).rows,
  );
  const again = read(out, MANABOX, NOW);

  expect(again.skipped).toEqual([]);
  // The file is written in a settled order, so what comes back is the same
  // stacks rather than the same list.
  expect(ordered(again.stacks)).toEqual(ordered(first.stacks));
});

test("an export names itself as the format it was written in", async () => {
  const text = await fixture("manabox-binder");
  const first = read(text, MANABOX, NOW);
  const out = write(
    rows(stacks(first.stacks), MANABOX, describing(text)).rows,
  );

  expect(parse(out)[0]).toEqual(columns(MANABOX));
});

test("copies bought at two figures are two rows", () => {
  const one: Owned = {
    scryfallId: "d40c73de-7a5f-46f2-a70b-449bc8ecfe24",
    finish: "foil",
    quantity: 3,
    createdAt: NOW,
    acquisitions: [
      { quantity: 1, marketValue: "0.18", marketCurrency: "GBP" },
      { quantity: 2, marketValue: "0.20", marketCurrency: "GBP" },
    ],
  };
  const { rows: out } = rows(stacks([one]), MANABOX, () => new Map());

  expect(out.slice(1).map((row) => [row[QUANTITY], row[PRICE]])).toEqual([
    ["1", "0.18"],
    ["2", "0.20"],
  ]);
});

test("copies no lot covers go out with no figure against them", () => {
  const one: Owned = {
    scryfallId: "d40c73de-7a5f-46f2-a70b-449bc8ecfe24",
    finish: "nonfoil",
    quantity: 5,
    createdAt: NOW,
    acquisitions: [
      { quantity: 2, marketValue: "0.18", marketCurrency: "GBP" },
    ],
  };
  const { rows: out } = rows(stacks([one]), MANABOX, () => new Map());

  expect(out.slice(1).map((row) => [row[QUANTITY], row[PRICE]])).toEqual([
    ["2", "0.18"],
    ["3", ""],
  ]);
});

test("a history outrunning what is held exports what is held", () => {
  const one: Owned = {
    scryfallId: "d40c73de-7a5f-46f2-a70b-449bc8ecfe24",
    finish: "nonfoil",
    quantity: 1,
    createdAt: NOW,
    acquisitions: [
      { quantity: 4, marketValue: "0.18", marketCurrency: "GBP" },
    ],
  };
  const { rows: out } = rows(stacks([one]), MANABOX, () => new Map());

  expect(out.slice(1).map((row) => row[QUANTITY])).toEqual(["1"]);
});

test("a printing the catalog cannot name is counted, not dropped", () => {
  const one: Owned = {
    scryfallId: "d40c73de-7a5f-46f2-a70b-449bc8ecfe24",
    finish: "nonfoil",
    quantity: 2,
    createdAt: NOW,
  };
  const written = rows(stacks([one]), MANABOX, () => new Map());

  expect(written.unnamed).toBe(2);
  expect(written.rows).toHaveLength(2);
  expect(written.rows[1]?.[SCRYFALL]).toBe(one.scryfallId);
  expect(written.rows[1]?.[NAME]).toBe("");
});

test("what the format has no column for is named before the file is", () => {
  const one: Owned = {
    scryfallId: "d40c73de-7a5f-46f2-a70b-449bc8ecfe24",
    finish: "nonfoil",
    quantity: 1,
    createdAt: NOW,
    container: "at://x/app.manaweb.container/one",
    note: "signed at a prerelease",
    proxy: true,
    tags: ["altered", "signed"],
    acquisitions: [{ quantity: 1, price: "2.00", currency: "GBP" }],
  };
  const { dropped } = rows(stacks([one]), MANABOX, () => new Map());

  expect(dropped).toEqual(["container", "note", "price"]);
});

test("a collection carrying only what fits loses nothing", () => {
  const one: Owned = {
    scryfallId: "d40c73de-7a5f-46f2-a70b-449bc8ecfe24",
    finish: "nonfoil",
    quantity: 1,
    createdAt: NOW,
    tags: ["misprint"],
  };
  expect(rows(stacks([one]), MANABOX, () => new Map()).dropped).toEqual([]);
});

test("one collection writes one file however the repo ordered it", async () => {
  const text = await fixture("manabox-binder");
  const { stacks: owned } = read(text, MANABOX, NOW);
  const describe = describing(text);

  const forward = write(rows(stacks(owned), MANABOX, describe).rows);
  const backward = write(
    rows(stacks([...owned].reverse()), MANABOX, describe).rows,
  );

  expect(backward).toBe(forward);
});

// Their own file is the only thing that can say whether ManaBox will read
// ours, so every row is held to the one it came from. Two columns cannot
// match: `ManaBox ID` is theirs to issue, and they write a currency beside a
// blank price, which is not a figure and so is not a lot to write back.
test.each(FIXTURES)(
  "%s goes back out as the file it came from",
  async (name) => {
    const text = await fixture(name);
    const { stacks: owned } = read(text, MANABOX, NOW);
    const { rows: out } = rows(stacks(owned), MANABOX, describing(text));

    const same = (row: string[]) =>
      row
        .map((cell, at) => (at === CURRENCY && !row[PRICE] ? "" : cell))
        .filter((_, at) => at !== THEIR_ID)
        .join("|");

    const theirs = parse(text).slice(1).map(same).sort();
    expect(out.slice(1).map(same).sort()).toEqual(theirs);
  },
);

test("a lot counting none of the copies puts none in the file", () => {
  const none: Owned = {
    scryfallId: "d40c73de-7a5f-46f2-a70b-449bc8ecfe24",
    finish: "nonfoil",
    quantity: 2,
    createdAt: NOW,
    acquisitions: [{ quantity: 0 }, { quantity: -3 }],
  };
  const { rows: out } = rows(stacks([none]), MANABOX, () => new Map());

  expect(out.slice(1).map((row) => row[QUANTITY])).toEqual(["2"]);
});

test("a fractional lot is the copies it covers whole", () => {
  const part: Owned = {
    scryfallId: "d40c73de-7a5f-46f2-a70b-449bc8ecfe24",
    finish: "nonfoil",
    quantity: 3,
    createdAt: NOW,
    acquisitions: [{ quantity: 1.9, marketValue: "2", marketCurrency: "GBP" }],
  };
  const { rows: out } = rows(stacks([part]), MANABOX, () => new Map());

  expect(out.slice(1).map((row) => row[QUANTITY])).toEqual(["1", "2"]);
});

test("a finish the format cannot spell is counted, not assumed", () => {
  const odd: Owned = {
    scryfallId: "d40c73de-7a5f-46f2-a70b-449bc8ecfe24",
    finish: "glossy",
    quantity: 2,
    createdAt: NOW,
  };
  const written = rows(stacks([odd]), MANABOX, () => new Map());

  expect(written.unspelled).toBe(2);
  expect(written.rows[1]?.[FINISH]).toBe("glossy");
});

test("a finish the format spells is not counted against it", () => {
  const plain: Owned = {
    scryfallId: "d40c73de-7a5f-46f2-a70b-449bc8ecfe24",
    finish: "etched",
    quantity: 1,
    createdAt: NOW,
  };
  expect(rows(stacks([plain]), MANABOX, () => new Map()).unspelled).toBe(0);
});
