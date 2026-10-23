import { published } from "./CatalogStatus";
import type { Loaded } from "./catalog/load";
import { CATALOG } from "./config";
import { Modal } from "./Modal";
import { stamp } from "./stamp";
import type { Status } from "./useCatalog";

// What the app is rather than what is in it: the catalog it loaded, the build
// serving it, and what the licenses oblige.
export function About({
  status,
  loaded,
}: {
  status: Status;
  loaded: Loaded | null;
}) {
  return (
    <Modal trigger="summary" title="About Manaweb" label="About">
      {loaded && <Catalog loaded={loaded} status={status} />}
      <h3>Build</h3>
      <p className="quiet">{stamp()}</p>
      <Licenses />
    </Modal>
  );
}

function Catalog({ loaded, status }: { loaded: Loaded; status: Status }) {
  const { catalog, manifest, cached } = loaded;

  return (
    <>
      <h3>Catalog</h3>
      <p className="quiet">
        {catalog.cards.toLocaleString()} cards · {published(catalog.version)}
        {cached && " · cached"}
      </p>
      <dl>
        <dt>Version</dt>
        <dd>{catalog.version}</dd>
        <dt>Cards</dt>
        <dd>{rows(manifest.cards.rows, manifest.cards.bytes)}</dd>
        <dt>Printings</dt>
        <dd>{rows(manifest.prints.rows, manifest.prints.bytes)}</dd>
        <dt>Read from</dt>
        <dd>{cached ? "this device" : CATALOG}</dd>
        <dt>Checked</dt>
        <dd>
          {status.checkedAt ? status.checkedAt.toLocaleTimeString() : "never"}
          {status.error && ` — ${status.error}`}
        </dd>
      </dl>
      <p className="actions">
        <button
          type="button"
          onClick={status.check}
          disabled={status.checking}
        >
          {status.checking ? "Checking…" : "Check for a newer catalog"}
        </button>
        <button type="button" onClick={status.reset}>
          Forget and download again
        </button>
      </p>
    </>
  );
}

// The Fan Content Policy asks for its disclaimer verbatim and Scryfall for a
// credit naming them as the source; neither asks for a place. See `docs/ip.md`.
function Licenses() {
  return (
    <>
      <h3>Licenses</h3>
      <p>
        Manaweb is unofficial Fan Content permitted under the{" "}
        <a href="https://company.wizards.com/en/legal/fancontentpolicy">
          Fan Content Policy
        </a>
        . Not approved/endorsed by Wizards. Portions of the materials used are
        property of Wizards of the Coast. ©Wizards of the Coast LLC.
      </p>
      <dl>
        <dt>Manaweb</dt>
        <dd>
          AGPL-3.0-only —{" "}
          <a href="https://github.com/eth0net/manaweb">source</a>
        </dd>

        <dt>Card names, text and mana symbols</dt>
        <dd>
          ©Wizards of the Coast LLC, used under the{" "}
          <a href="https://company.wizards.com/en/legal/fancontentpolicy">
            Fan Content Policy
          </a>
        </dd>

        <dt>Card data and images</dt>
        <dd>
          <a href="https://scryfall.com">Scryfall</a>, under their{" "}
          <a href="https://scryfall.com/docs/api">API terms</a>. Hotlinked
          rather than redistributed, and not endorsed by Scryfall.
        </dd>

        <dt>React, React DOM</dt>
        <dd>MIT</dd>

        <dt>Flip icon</dt>
        <dd>
          <a href="https://github.com/akveo/eva-icons">Eva Icons</a>, MIT
        </dd>
      </dl>
    </>
  );
}

function rows(count: number, bytes: number) {
  return `${count.toLocaleString()} rows · ${(bytes / 1e6).toFixed(1)} MB`;
}
