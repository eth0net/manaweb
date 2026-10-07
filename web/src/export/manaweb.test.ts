import { expect, test } from "bun:test";
import type { Owned, Stack } from "../collection/cards";
import { columns, detect, FORMATS, MANABOX, MANAWEB } from "../import/formats";
import { header, read } from "../import/read";
import { write } from "./csv";
import { type Describe, rows } from "./rows";

const NOW = "2026-10-05T00:00:00.000Z";
const ID = "d40c73de-7a5f-46f2-a70b-449bc8ecfe24";
const BINDER = "at://x/app.manaweb.container/one";
const PLACES = new Map([[BINDER, "Draft binder"]]);

// Every field a record can carry, so what the file loses is visible.
const WHOLE: Owned[] = [
  {
    scryfallId: ID,
    finish: "etched",
    quantity: 3,
    condition: "lightPlayed",
    container: BINDER,
    proxy: true,
    note: 'Signed, "Ach! Hans, Run!"',
    tags: ["altered", "misprint", "signed"],
    acquisitions: [
      {
        quantity: 1,
        at: "2025-01-01T00:00:00.000Z",
        price: "2.50",
        currency: "GBP",
        marketValue: "3.00",
        marketCurrency: "USD",
      },
      {
        quantity: 2,
        at: "2025-06-01T00:00:00.000Z",
        price: "1.00",
        currency: "EUR",
      },
    ],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2026-02-02T00:00:00.000Z",
  },
  {
    scryfallId: "c49d6139-fc0c-41db-be08-dfa87c685092",
    finish: "nonfoil",
    quantity: 1,
    createdAt: "2024-03-03T00:00:00.000Z",
  },
];

function stacks(owned: Owned[]): Stack[] {
  return owned.map((value, at) => ({ uri: `at://x/${at}`, cid: "", value }));
}

function exported(owned: Owned[] = WHOLE): string {
  return write(
    rows(stacks(owned), MANAWEB, () => new Map(), { places: PLACES }).rows,
  );
}

test("the file names itself rather than the tracker it is not", () => {
  expect(detect(header(exported()))?.name).toBe("Manaweb");
});

test("a format with no header of its own writes what it binds", () => {
  expect(columns(MANAWEB)).toEqual(Object.values(MANAWEB.binding));
  expect(header(exported())).toEqual(columns(MANAWEB));
});

test("every column a record can fill is one this format has", () => {
  expect(
    rows(stacks(WHOLE), MANAWEB, () => new Map(), { places: PLACES }).dropped,
  ).toEqual([]);
});

// The one field a reader cannot put back — `docs/scryfall.md`.
test("a collection comes back whole but for where it was filed", () => {
  const { stacks: back, skipped } = read(exported(), MANAWEB, NOW);

  expect(skipped).toEqual([]);
  expect(back).toEqual(
    WHOLE.map(({ container: _, ...rest }) => rest as Owned),
  );
});

test("where it was filed is written even so", () => {
  const { rows: out } = rows(stacks(WHOLE), MANAWEB, () => new Map(), {
    places: PLACES,
  });
  const at = columns(MANAWEB).indexOf("Container");

  expect(out[1]?.[at]).toBe("Draft binder");
  expect(out[3]?.[at]).toBe("");
});

test("a note carrying a comma and a quote survives the trip", () => {
  const { stacks: back } = read(exported(), MANAWEB, NOW);
  expect(back[0]?.note).toBe('Signed, "Ach! Hans, Run!"');
});

test("a lot keeps the day it was come by", () => {
  const { stacks: back } = read(exported(), MANAWEB, NOW);
  expect(back[0]?.acquisitions?.map((one) => one.at)).toEqual([
    "2025-01-01T00:00:00.000Z",
    "2025-06-01T00:00:00.000Z",
  ]);
});

test("a ManaBox file is not read as this one", async () => {
  const at = new URL("../import/fixtures/manabox-binder.csv", import.meta.url);
  expect(detect(header(await Bun.file(at).text()))?.name).toBe("ManaBox");
});

test("no format writes one column twice", () => {
  for (const format of FORMATS) {
    const written = columns(format);
    expect(new Set(written).size).toBe(written.length);
  }
});

test("a container written and not read back is said so", () => {
  const { unread } = rows(stacks(WHOLE), MANAWEB, () => new Map(), {
    places: PLACES,
  });
  expect(unread).toEqual(["container"]);
});

test("a collection filed nowhere loses nothing to that", () => {
  const loose = WHOLE.map(({ container: _, ...rest }) => rest as Owned);
  const { unread, dropped } = rows(stacks(loose), MANAWEB, () => new Map());
  expect([...unread, ...dropped]).toEqual([]);
});

test("a format with no column for it says nothing about reading it back", () => {
  const { unread } = rows(stacks(WHOLE), MANABOX, () => new Map(), {
    places: PLACES,
  });
  expect(unread).toEqual([]);
});

test("a day with no figure beside it is still a lot", () => {
  const dated: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 1,
    acquisitions: [{ quantity: 1, at: "2025-02-02T00:00:00.000Z" }],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  const { stacks: back } = read(exported([dated]), MANAWEB, NOW);

  expect(back[0]?.acquisitions).toEqual([
    { quantity: 1, at: "2025-02-02T00:00:00.000Z" },
  ]);
});

// ManaBox added `Signed` and `Proxy` after we had read one of its files, so
// a file written before they existed is still a ManaBox file.
test("a vendor's older file is still that vendor's file", () => {
  const before = columns(MANABOX).filter(
    (one) => one !== "Signed" && one !== "Proxy",
  );
  expect(detect(before)?.name).toBe("ManaBox");
});

test("a column no reader could do without is still required", () => {
  const short = columns(MANAWEB).filter((one) => one !== "Finish");
  expect(detect(short)).toBeNull();
});

// One vendor's lateness is not another's: ManaBox added `Proxy` after we had
// read one of its files, and ours has carried it from the first.
test("a column another vendor added late is still ours to require", () => {
  const short = columns(MANAWEB).filter((one) => one !== "Proxy");
  expect(detect(short)).toBeNull();
});

test("a year no lexicon would take is not read at all", () => {
  const far = exported([
    {
      ...(WHOLE[1] as Owned),
      acquisitions: [{ quantity: 1, at: "2025-01-01T00:00:00.000Z" }],
    },
  ]).replace("2025-01-01T00:00:00.000Z", "275760-09-12");
  const { stacks: back } = read(far, MANAWEB, NOW);

  expect(back[0]?.acquisitions).toBeUndefined();
});

test("a column that is not a date at all is not guessed at", () => {
  for (const said of ["12", "Mar 3", "2025", "yes", ""]) {
    const one = exported([WHOLE[1] as Owned]).replace(
      "2024-03-03T00:00:00.000Z",
      said,
    );
    const { stacks: back } = read(one, MANAWEB, NOW);
    expect(back[0]?.createdAt).toBe(NOW);
  }
});

test("a tag is cut to the bytes a lexicon counts, not the units", () => {
  const long: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 1,
    tags: ["\u{1F600}".repeat(32)],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  const { stacks: back } = read(exported([long]), MANAWEB, NOW);
  const tag = back[0]?.tags?.[0] ?? "";

  expect(new TextEncoder().encode(tag).length).toBeLessThanOrEqual(64);
  expect([...tag]).toHaveLength(16);
});

test("a tag holding the comma it is joined on is counted as lost", () => {
  const comma: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 2,
    tags: ["foo, bar"],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  expect(rows(stacks([comma]), MANAWEB, () => new Map()).unkept).toBe(2);
});

test("a figure with no currency beside it is counted as lost", () => {
  const loose: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 1,
    acquisitions: [{ quantity: 1, price: "2.50" }],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  expect(rows(stacks([loose]), MANAWEB, () => new Map()).unkept).toBe(1);
});

test("a lot that is only a count is counted as lost", () => {
  const bare: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 3,
    acquisitions: [{ quantity: 2 }],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  expect(rows(stacks([bare]), MANAWEB, () => new Map()).unkept).toBe(3);
});

test("a collection a read puts back whole is counted as nothing", () => {
  expect(
    rows(stacks(WHOLE), MANAWEB, () => new Map(), { places: PLACES }).unkept,
  ).toBe(0);
});

test("a tag comma is nothing to a format with no tags column", () => {
  const comma: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 1,
    tags: ["foo, bar"],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  expect(rows(stacks([comma]), MANABOX, () => new Map()).unkept).toBe(0);
});

test("a note is cut between characters, never through one", () => {
  const long: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 1,
    note: "\u{1F600}".repeat(400),
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  const { stacks: back } = read(exported([long]), MANAWEB, NOW);
  const note = back[0]?.note ?? "";

  expect([...note]).toHaveLength(300);
  // With the unicode flag the class reaches only an unpaired surrogate,
  // which is what a cut through a pair leaves behind.
  expect(note).not.toMatch(/[\uD800-\uDFFF]/u);
});

test("when a stack last changed survives the trip", () => {
  const { rows: out } = rows(stacks(WHOLE), MANAWEB, () => new Map(), {
    places: PLACES,
  });
  const at = columns(MANAWEB).indexOf("Updated");

  expect(out[1]?.[at]).toBe("2026-02-02T00:00:00.000Z");
  expect(out[3]?.[at]).toBe("");
});

// Reading changes nothing, so the later date stands — `docs/scryfall.md`.
test("two rows of one stack keep the later date between them", () => {
  const early: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 1,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
  const late: Owned = { ...early, updatedAt: "2026-06-06T00:00:00.000Z" };
  const { stacks: back } = read(exported([early, late]), MANAWEB, NOW);

  expect(back).toHaveLength(1);
  expect(back[0]?.quantity).toBe(2);
  expect(back[0]?.updatedAt).toBe("2026-06-06T00:00:00.000Z");
});

// Both were in ManaBox's export before they were in our binding, so a card
// came back from one having lost them.
test("a vendor's newer columns are read and written", () => {
  const marked: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 1,
    proxy: true,
    tags: ["altered", "misprint", "signed"],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  const file = write(rows(stacks([marked]), MANABOX, () => new Map()).rows);
  const { stacks: back } = read(file, MANABOX, NOW);

  expect(back[0]?.tags).toEqual(["altered", "misprint", "signed"]);
  expect(back[0]?.proxy).toBe(true);
});

test("a card that is none of those says so rather than nothing", () => {
  const plain: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 1,
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  const { stacks: back } = read(
    write(rows(stacks([plain]), MANABOX, () => new Map()).rows),
    MANABOX,
    NOW,
  );

  expect(back[0]?.tags).toBeUndefined();
  expect(back[0]?.proxy).toBeUndefined();
});

const PHYREXIAN = "36ccde39-98bd-4a67-bfcf-a66d9fbd9417";

// ManaBox refuses this one while its own export calls those printings
// English — `docs/scryfall.md`.
function phyrexian(): Describe {
  return () =>
    new Map([
      [
        PHYREXIAN,
        {
          card: { name: "Plains" },
          print: {
            set: "one",
            setName: "Phyrexia: All Will Be One",
            collectorNumber: "267",
            rarity: "common",
            lang: "ph",
          },
        },
      ],
    ]);
}

const LAND: Owned = {
  scryfallId: PHYREXIAN,
  finish: "nonfoil",
  quantity: 3,
  createdAt: "2024-01-01T00:00:00.000Z",
};

test("a language the vendor turns down is counted and still written", () => {
  const written = rows(stacks([LAND]), MANABOX, phyrexian());
  const at = columns(MANABOX).indexOf("Language");

  expect(written.refused).toBe(3);
  expect(written.rows[1]?.[at]).toBe("ph");
});

test("asked for English, that is what the column says", () => {
  const written = rows(stacks([LAND]), MANABOX, phyrexian(), {
    english: true,
  });
  const at = columns(MANABOX).indexOf("Language");

  expect(written.refused).toBe(3);
  expect(written.rows[1]?.[at]).toBe("en");
});

test("a language the vendor takes is left alone either way", () => {
  const japanese: Describe = () =>
    new Map([
      [
        PHYREXIAN,
        {
          card: { name: "Plains" },
          print: {
            set: "one",
            setName: "x",
            collectorNumber: "1",
            rarity: "common",
            lang: "ja",
          },
        },
      ],
    ]);
  const at = columns(MANABOX).indexOf("Language");

  for (const english of [false, true]) {
    const written = rows(stacks([LAND]), MANABOX, japanese, { english });
    expect(written.refused).toBe(0);
    expect(written.rows[1]?.[at]).toBe("ja");
  }
});

test("a format that refuses nothing is never asked to substitute", () => {
  const written = rows(stacks([LAND]), MANAWEB, phyrexian(), {
    english: true,
  });
  const at = columns(MANAWEB).indexOf("Language");

  expect(written.refused).toBe(0);
  expect(written.rows[1]?.[at]).toBe("ph");
});

// A lexicon setting no `minLength` takes this, so a PDS holds it.
test("a figure the record leaves empty is counted as lost", () => {
  const blank: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 1,
    acquisitions: [{ quantity: 1, price: "", currency: "GBP" }],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  const { stacks: back } = read(exported([blank]), MANAWEB, NOW);

  expect(rows(stacks([blank]), MANAWEB, () => new Map()).unkept).toBe(1);
  expect(back[0]?.acquisitions).toBeUndefined();
});

test("a figure the record fills is not counted against it", () => {
  const paid: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 1,
    acquisitions: [{ quantity: 1, price: "2.50", currency: "GBP" }],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  expect(rows(stacks([paid]), MANAWEB, () => new Map()).unkept).toBe(0);
});

// Three characters of space satisfy the lexicon's length and nothing else:
// the reader wants a currency beside an amount, and drops the lot without one.
test("a currency a read will not take is counted as lost", () => {
  const spaces: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 1,
    acquisitions: [{ quantity: 1, price: "2.50", currency: "   " }],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  const { stacks: back } = read(exported([spaces]), MANAWEB, NOW);

  expect(rows(stacks([spaces]), MANAWEB, () => new Map()).unkept).toBe(1);
  expect(back[0]?.acquisitions).toBeUndefined();
});

// A stack holding fewer copies than its history bought, which is what selling
// or trading part of one looks like.
test("a lot with no copies left to spend on is counted as lost", () => {
  const sold: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 1,
    acquisitions: [
      {
        quantity: 1,
        price: "120.00",
        currency: "GBP",
        at: "2019-04-01T00:00:00.000Z",
      },
      {
        quantity: 2,
        price: "250.00",
        currency: "GBP",
        at: "2021-06-01T00:00:00.000Z",
      },
    ],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  const written = rows(stacks([sold]), MANAWEB, () => new Map());
  const { stacks: back } = read(write(written.rows), MANAWEB, NOW);

  expect(written.unspent).toBe(1);
  expect(written.rows).toHaveLength(2);
  expect(back[0]?.acquisitions).toHaveLength(1);
});

test("a history the copies cover is counted as nothing", () => {
  expect(
    rows(stacks(WHOLE), MANAWEB, () => new Map(), { places: PLACES }).unspent,
  ).toBe(0);
});

// The cap shortens this lot rather than dropping it, and what it cost is in
// the row either way.
test("a lot the copies only part cover is not counted against the file", () => {
  const most: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 1,
    acquisitions: [{ quantity: 4, price: "1.00", currency: "GBP" }],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  expect(rows(stacks([most]), MANAWEB, () => new Map()).unspent).toBe(0);
});
