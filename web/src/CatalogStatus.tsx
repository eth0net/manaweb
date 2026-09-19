import type { Status } from "./useCatalog";

// The one thing about the catalog worth interrupting for, so it sits in the
// page rather than in the menu holding everything else.
export function CatalogUpdate({ status }: { status: Status }) {
  if (!status.available) return null;
  return (
    <p className="update">
      A catalog published {published(status.available.version)} is available.{" "}
      <button type="button" onClick={status.apply}>
        Load it
      </button>
    </p>
  );
}

// The bulk file's own timestamp, so its age shows whether the sync still runs.
export function published(version: string) {
  const at = new Date(version);
  const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
  const day = at.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  if (days < 1) return `${day}, today`;
  if (days === 1) return `${day}, yesterday`;
  return `${day}, ${days} days ago`;
}
