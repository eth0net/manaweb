import type { ReactNode } from "react";
import { entry, HOME, Link, TABS, tab } from "./router";
import { SETS } from "./Sets";

// A name you already know, or a set to look through: different enough to be
// two places rather than one view that changes shape when the box is empty.
const MODES = [
  { path: HOME, label: "Search" },
  { path: SETS, label: "Sets" },
];

export function Modes({ path, crumb }: { path: string; crumb?: ReactNode }) {
  return (
    <p className="modes">
      {MODES.map(({ path: to, label }) => (
        <Link key={to} to={to} className={to === path ? "here" : undefined}>
          {label}
        </Link>
      ))}
      {crumb && <span className="quiet">{crumb}</span>}
    </p>
  );
}

export function Nav({ path }: { path: string }) {
  const here = tab(path);

  return (
    <nav>
      {TABS.map(({ path: to, label }) => (
        <Link
          key={to}
          to={entry(to, here)}
          className={to === here ? "here" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
