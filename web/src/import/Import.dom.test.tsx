import { expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import type { Catalog } from "../catalog";
import type { Holdings } from "../collection/cards";
import { type Entry, SCANNED, type Source } from "../scan/scratch";
import type { Scratch } from "../scan/store";
import "../testing/dom";
import { Import } from "./Import";

const HEAD =
  "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID," +
  "Scryfall ID,Purchase price,Misprint,Altered,Condition,Language," +
  "Purchase price currency,Added";

const ONE = "d40c73de-7a5f-46f2-a70b-449bc8ecfe24";

function line(foil: string): string {
  return `Infestation Sage,FDN,Foundations,64,${foil},common,1,101601,${ONE},0.18,false,false,near_mint,en,GBP,2025-11-22T13:20:10.577Z`;
}

// Only what the screen reads, so a change to the rest does not reach here.
const owning = {
  ready: true,
  fresh: true,
  stacks: [],
  printings: [],
  total: 0,
} as unknown as Holdings;

const catalog = {
  locate: () => new Map(),
  resolve: (ids: Iterable<string>) =>
    new Map(
      [...ids].map((id) => [
        id,
        { card: {}, print: { finishes: ["nonfoil", "foil"] } },
      ]),
    ),
} as unknown as Catalog;

// No list held, which is the only state in which a file may be read in.
const scratch = {
  ready: true,
  source: SCANNED,
  list: [],
  change: () => {},
  begin: () => {},
  clear: async () => {},
  problem: null,
} satisfies Scratch;

function choose(text: string) {
  const input = document.querySelector("input[type=file]") as HTMLInputElement;
  const file = new File([text], "collection.csv", { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });
}

test("a signed out visitor is told why not", () => {
  const { getByText } = render(
    <Import
      session={null}
      owning={owning}
      catalog={catalog}
      container={null}
      scratch={scratch}
    />,
  );
  expect(getByText(/Importing needs an account/)).toBeTruthy();
});

test("a finish the printing never came in is named by line", async () => {
  const { findByText, getByRole } = render(
    <Import
      session={{} as never}
      owning={owning}
      catalog={catalog}
      container={null}
      scratch={scratch}
    />,
  );

  choose(`${HEAD}\n${line("etched")}\n${line("normal")}`);
  const said = await findByText(/is nonfoil and foil only, not etched/);

  expect(said.textContent).toContain("Line 2");
  // The good row still lands, which is what skip-and-report means on screen.
  expect(getByRole("button").textContent).toContain("Review 1 row");
});

test("a file read in goes to the list, not to the repo", async () => {
  const started: [Source, Entry[]][] = [];
  const { findByRole } = render(
    <Import
      session={{} as never}
      owning={owning}
      catalog={catalog}
      container={null}
      scratch={{
        ...scratch,
        begin: (source, list) => started.push([source, list]),
      }}
    />,
  );

  choose(`${HEAD}\n${line("normal")}\n${line("foil")}`);
  fireEvent.click(await findByRole("button", { name: /Review 2 rows/ }));

  expect(started).toHaveLength(1);
  expect(started[0]?.[0]).toMatchObject({
    at: "file",
    format: "ManaBox",
    file: "collection.csv",
  });
  // In the file's order, each knowing which line it was.
  expect(started[0]?.[1].map((one) => one.line)).toEqual([2, 3]);
});

// The list held is the only copy of whatever is in it, so a file cannot take
// its place without somebody saying so.
test("a file waits while another list is open", async () => {
  const { findByText, queryByRole } = render(
    <Import
      session={{} as never}
      owning={owning}
      catalog={catalog}
      container={null}
      scratch={{ ...scratch, list: [{ id: "a" } as Entry] }}
    />,
  );

  choose(`${HEAD}\n${line("normal")}`);
  expect(await findByText(/A list is already open/)).toBeTruthy();
  expect(queryByRole("button", { name: /Review/ })).toBeNull();
});

// Unread and empty look alike, and reading a file in over a list nobody has
// seen yet is the one thing this screen must not do.
test("a file waits while the list is still being read", async () => {
  const { findByText, queryByRole } = render(
    <Import
      session={{} as never}
      owning={owning}
      catalog={catalog}
      container={null}
      scratch={{ ...scratch, ready: false }}
    />,
  );

  choose(`${HEAD}\n${line("normal")}`);
  expect(await findByText(/Looking for a list already open/)).toBeTruthy();
  expect(queryByRole("button", { name: /Review/ })).toBeNull();
});

// The plan below joins a file's rows to stacks in one container, and that
// container is chosen on another screen entirely.
test("the preview names the container it planned against", async () => {
  const { findByText } = render(
    <Import
      session={{} as never}
      owning={owning}
      catalog={catalog}
      container="at://binder"
      place="Trade binder"
      scratch={scratch}
    />,
  );

  choose(`${HEAD}\n${line("normal")}`);
  expect((await findByText(/Read as ManaBox/)).textContent).toContain(
    "filed under Trade binder",
  );
});
