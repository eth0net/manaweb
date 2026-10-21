import { at, rev } from "virtual:built";

// Read back in whatever zone the reader is in: the question it answers is
// whether this is the build just made, and that is asked against a wall clock.
export function stamp() {
  const when = new Date(at).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
  return `built ${when} · ${rev}`;
}
