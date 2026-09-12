import { expect, test } from "bun:test";
import { read } from "./manabox";

const NOW = "2026-09-13T00:00:00.000Z";

const HEAD =
  "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID," +
  "Scryfall ID,Purchase price,Misprint,Altered,Condition,Language," +
  "Purchase price currency,Added";

const ONE = "d40c73de-7a5f-46f2-a70b-449bc8ecfe24";

// One row, with only the columns a test varies spelled out.
function row({
  id = ONE,
  foil = "normal",
  quantity = "1",
  price = "0.18",
  misprint = "false",
  altered = "false",
  condition = "near_mint",
  currency = "GBP",
  added = "2025-11-22T13:20:10.577Z",
} = {}): string {
  return [
    "Infestation Sage,FDN,Foundations,64",
    foil,
    "common",
    quantity,
    "101601",
    id,
    price,
    misprint,
    altered,
    condition,
    "en",
    currency,
    added,
  ].join(",");
}

function one(...rows: string[]) {
  const { stacks, skipped } = read([HEAD, ...rows].join("\n"), NOW);
  return { stack: stacks[0], stacks, skipped };
}

async function fixture(name: string): Promise<string> {
  const at = new URL(`./fixtures/${name}.csv`, import.meta.url);
  return await Bun.file(at).text();
}

test("a binder export reads every row", async () => {
  const { stacks, skipped } = read(await fixture("manabox-binder"), NOW);
  expect(skipped).toEqual([]);
  expect(stacks).toHaveLength(25);
  expect(stacks.reduce((sum, held) => sum + held.quantity, 0)).toBe(43);
});

test("a name carrying a comma survives the row it sits in", async () => {
  const { stacks } = read(await fixture("manabox-binder"), NOW);
  const etched = stacks.filter((held) => held.finish === "etched");
  expect(etched).toHaveLength(2);
});

test("every line ending reads the same collection", async () => {
  const text = await fixture("manabox-binder");
  expect(read(text.replaceAll("\n", "\r\n"), NOW)).toEqual(read(text, NOW));
});

test("a finish is what the record calls it", () => {
  expect(one(row({ foil: "normal" })).stack?.finish).toBe("nonfoil");
  expect(one(row({ foil: "foil" })).stack?.finish).toBe("foil");
  expect(one(row({ foil: "etched" })).stack?.finish).toBe("etched");
});

test("a grade is the lexicon's spelling of it", () => {
  expect(one(row({ condition: "near_mint" })).stack?.condition).toBe(
    "nearMint",
  );
  expect(one(row({ condition: "light_played" })).stack?.condition).toBe(
    "lightPlayed",
  );
});

test("a grade nothing recognizes leaves the stack ungraded", () => {
  expect(one(row({ condition: "pristine" })).stack?.condition).toBeUndefined();
});

test("the price column is what a copy was worth, not what was paid", () => {
  expect(one(row()).stack?.acquisitions).toEqual([
    { quantity: 1, marketValue: "0.18", marketCurrency: "GBP" },
  ]);
});

test("a sum with no currency beside it is no lot at all", () => {
  expect(one(row({ currency: "" })).stack?.acquisitions).toBeUndefined();
  expect(one(row({ price: "" })).stack?.acquisitions).toBeUndefined();
});

test("the added date seeds the record, and a missing one is now", () => {
  expect(one(row()).stack?.createdAt).toBe("2025-11-22T13:20:10.577Z");
  expect(one(row({ added: "" })).stack?.createdAt).toBe(NOW);
});

test("misprint and altered land as tags", () => {
  expect(one(row({ misprint: "true", altered: "true" })).stack?.tags).toEqual([
    "altered",
    "misprint",
  ]);
  expect(one(row()).stack?.tags).toBeUndefined();
});

test("identical rows are one stack", () => {
  const { stacks } = one(row({ quantity: "2" }), row({ quantity: "3" }));
  expect(stacks).toHaveLength(1);
  expect(stacks[0]?.quantity).toBe(5);
});

test("a row differing only in price joins, keeping both figures", () => {
  const { stacks } = one(row({ price: "0.18" }), row({ price: "0.31" }));
  expect(stacks).toHaveLength(1);
  expect(stacks[0]?.acquisitions).toHaveLength(2);
});

test("a merge keeps the earlier of the two dates", () => {
  const { stacks } = one(
    row({ added: "2026-04-07T22:14:49.647Z" }),
    row({ added: "2025-11-22T13:20:10.577Z" }),
  );
  expect(stacks[0]?.createdAt).toBe("2025-11-22T13:20:10.577Z");
});

test("a differing grade stays a stack of its own", () => {
  const { stacks } = one(row(), row({ condition: "played" }));
  expect(stacks).toHaveLength(2);
});

test("a row naming no printing is skipped by line", () => {
  const { stacks, skipped } = one(row(), row({ id: "" }), row({ id: "x" }));
  expect(stacks).toHaveLength(1);
  expect(skipped).toEqual([
    { line: 3, reason: "no print" },
    { line: 4, reason: "no such print x" },
  ]);
});

test("a count nothing can own is skipped", () => {
  expect(one(row({ quantity: "0" })).skipped).toHaveLength(1);
  expect(one(row({ quantity: "1.5" })).skipped).toHaveLength(1);
  expect(one(row({ quantity: "" })).skipped).toHaveLength(1);
});

test("a finish nothing recognizes is skipped rather than guessed", () => {
  expect(one(row({ foil: "shiny" })).skipped).toEqual([
    { line: 2, reason: "unknown finish shiny" },
  ]);
});

test("a file missing a column it is read by yields nothing", () => {
  const { stacks, skipped } = read("Name,Set code\nInfestation Sage,FDN", NOW);
  expect(stacks).toEqual([]);
  expect(skipped).toEqual([
    { line: 1, reason: "no scryfall id, foil, quantity column" },
  ]);
});

test("an empty file is not an error", () => {
  expect(read("", NOW)).toEqual({ stacks: [], skipped: [] });
});

test("a blank line is not a row", () => {
  expect(one(row(), "").stacks).toHaveLength(1);
});
