import { expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import type { Catalog } from "../catalog";
import type { Holdings } from "../collection/cards";
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

function choose(text: string) {
  const input = document.querySelector("input[type=file]") as HTMLInputElement;
  const file = new File([text], "collection.csv", { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });
}

test("a signed out visitor is told why not", () => {
  const { getByText } = render(
    <Import session={null} owning={owning} catalog={catalog} />,
  );
  expect(getByText(/Importing needs an account/)).toBeTruthy();
});

test("a finish the printing never came in is named by line", async () => {
  const { findByText, getByRole } = render(
    <Import session={{} as never} owning={owning} catalog={catalog} />,
  );

  choose(`${HEAD}\n${line("etched")}\n${line("normal")}`);
  const said = await findByText(/is nonfoil and foil only, not etched/);

  expect(said.textContent).toContain("Line 2");
  // The good row still lands, which is what skip-and-report means on screen.
  expect(getByRole("button").textContent).toContain("Add 1 card");
});
