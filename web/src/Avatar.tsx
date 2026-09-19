import type { OAuthSession } from "@atproto/oauth-client-browser";
import { useEffect, useState } from "react";
import { avatar } from "./oauth/profile";

// Always something, so the control it sits in keeps its shape whether or not
// an account has a picture — and keeps a target once the handle beside it is
// too long to show.
export function Avatar({
  session,
  name,
}: {
  session: OAuthSession;
  name: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let made: string | null = null;

    avatar(session).then(
      (blob) => {
        if (!live || !blob) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      },
      () => {
        // A picture is decoration: failing to read one reports nothing.
      },
    );

    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [session]);

  if (url) return <img className="avatar" src={url} alt="" />;
  return (
    <span className="avatar" aria-hidden="true">
      {initial(name)}
    </span>
  );
}

// A handle's first letter, or a DID's first after the method, which is not
// meaningful but is at least steady for the same account.
function initial(name: string): string {
  const letter = name.replace(/^did:[a-z]+:/, "").match(/[a-z0-9]/i);
  return (letter?.[0] ?? "?").toUpperCase();
}
