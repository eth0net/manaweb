import type { ReactNode } from "react";
import { entry, HOME, Link, TABS, tab, useAddress } from "./router";
import { SETS } from "./Sets";

// A name you already know, or a set to look through: different enough to be
// two places rather than one view that changes shape when the box is empty.
const MODES = [
  { path: HOME, label: "Cards" },
  { path: SETS, label: "Sets" },
];

export function Modes({ path, crumb }: { path: string; crumb?: ReactNode }) {
  return (
    <>
      <p className="modes">
        {MODES.map(({ path: to, label }) => (
          <Link key={to} to={to} className={to === path ? "here" : undefined}>
            {label}
          </Link>
        ))}
      </p>
      {crumb && <p className="crumb quiet">{crumb}</p>}
    </>
  );
}

export function Nav({ path }: { path: string }) {
  const here = tab(path);
  const at = useAddress();

  return (
    <nav>
      {TABS.map(({ path: to, label }) => {
        const Mark = MARKS[to];
        return (
          <Link
            key={to}
            to={entry(to, at)}
            className={to === here ? "here" : undefined}
          >
            {Mark && <Mark />}
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// Keyed by the root rather than carried on the tab: `router.tsx` answers what
// a path belongs to and draws nothing — `licenses/README.md` says where these
// came from.
const MARKS: Record<string, () => ReactNode> = {
  "/cards": Search,
  "/collection": Box,
  "/scan": Camera,
  "/decks": Deck,
  "/lists": List,
};

function Search() {
  return (
    <svg viewBox="0 0 24 24" className="stroked" aria-hidden="true">
      <path d="M13.3891 13.3891L19 19M9.5 15C12.5376 15 15 12.5376 15 9.5C15 6.46243 12.5376 4 9.5 4C6.46243 4 4 6.46243 4 9.5C4 12.5376 6.46243 15 9.5 15Z" />
    </svg>
  );
}

function Box() {
  return (
    <svg viewBox="0 0 24 24" className="stroked" aria-hidden="true">
      <path d="M10 13H14M20 8V19C20 20.1046 19.1046 21 18 21H6C4.89543 21 4 20.1046 4 19V8M21 8V5C21 3.89543 20.1046 3 19 3H5C3.89543 3 3 3.89543 3 5V8H21Z" />
    </svg>
  );
}

function Camera() {
  return (
    <svg viewBox="0 0 24 24" className="stroked" aria-hidden="true">
      <path d="M15.0858 3.58579C14.7107 3.21071 14.202 3 13.6716 3H10.3284C9.79799 3 9.28929 3.21071 8.91421 3.58579L8.08579 4.41421C7.71071 4.78929 7.20201 5 6.67157 5H5C3.89543 5 3 5.89543 3 7L3 17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V7C21 5.89543 20.1046 5 19 5H17.3284C16.798 5 16.2893 4.78929 15.9142 4.41421L15.0858 3.58579Z" />
      <path d="M12 16C14.2091 16 16 14.2091 16 12C16 9.79086 14.2091 8 12 8C9.79086 8 8 9.79086 8 12C8 14.2091 9.79086 16 12 16Z" />
    </svg>
  );
}

// A phone outline at this size is a card, which is what both of these are
// standing for.
function Deck() {
  return (
    <svg viewBox="0 0 24 24" className="stroked" aria-hidden="true">
      <path d="M12.7344 18.25H14.25C14.8023 18.25 15.25 17.8023 15.25 17.25V15.75M11.2656 5.75H9.75C9.19772 5.75 8.75 6.19772 8.75 6.75V8.25M6 5L6 19C6 20.1046 6.89543 21 8 21H16C17.1046 21 18 20.1046 18 19V5C18 3.89543 17.1046 3 16 3L8 3C6.89543 3 6 3.89543 6 5Z" />
    </svg>
  );
}

function List() {
  return (
    <svg viewBox="0 0 24 24" className="stroked" aria-hidden="true">
      <path d="M15 3L16 3C17.1046 3 18 3.89543 18 5L18 19C18 20.1046 17.1046 21 16 21H8C6.89543 21 6 20.1046 6 19L6 5C6 3.89543 6.89543 3 8 3L9 3M15 3V4C15 5.10457 14.1046 6 13 6H11C9.89543 6 9 5.10457 9 4L9 3M15 3L9 3" />
    </svg>
  );
}
