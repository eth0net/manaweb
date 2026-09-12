import { type Catalog, words } from "../catalog";
import { IMPORT } from "../import/Import";
import { rkey } from "../oauth/repo";
import { Link } from "../router";
import type { Holdings } from "./cards";
import { type Containers, UNFILED } from "./containers";
import { Place } from "./Place";

const UNDER = "/collection/";

// What you own and where it sits, and one level down, what one place holds.
export function Collection({
  catalog,
  containers,
  owning,
  path,
}: {
  catalog: Catalog | null;
  containers: Containers;
  owning: Holdings;
  path: string;
}) {
  const key = path.startsWith(UNDER) ? path.slice(UNDER.length) : "";

  if (key) {
    const here = containers.held.find((one) => rkey(one.uri) === key);
    // An unknown key is a container this account no longer has, which reads
    // as an empty place rather than an error.
    return (
      <Place
        catalog={catalog}
        containers={containers}
        owning={owning}
        place={here?.uri ?? null}
        name={here?.value.name ?? UNFILED.name}
      />
    );
  }

  const unfiled = owning.copies(null);
  const empty = owning.total === 0 && containers.held.length === 0;

  return (
    <>
      <p className="tally">
        {owning.total.toLocaleString()} card{owning.total === 1 ? "" : "s"}
      </p>

      <p className="quiet">
        <Link className="link" to={IMPORT}>
          Import a CSV
        </Link>
      </p>

      {empty ? (
        <p className="quiet">
          Nothing yet. Search for a card and press the plus beside a printing.
        </p>
      ) : (
        <ul className="breakdown">
          {unfiled > 0 && (
            <li>
              <Link className="link" to={UNDER + UNFILED.key}>
                {UNFILED.name}
              </Link>
              <span className="quiet">unfiled</span>
              <span>{unfiled.toLocaleString()}</span>
            </li>
          )}
          {containers.held.map((one) => (
            <li key={one.uri}>
              <Link className="link" to={UNDER + rkey(one.uri)}>
                {one.value.name}
              </Link>
              <span className="quiet">
                {one.value.kind ? words(one.value.kind) : ""}
              </span>
              <span>{owning.copies(one.uri).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
