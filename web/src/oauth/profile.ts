import type { OAuthSession } from "@atproto/oauth-client-browser";
import type { BlobRef } from "../lexicons/app/manaweb/profile";
import { put, query, remove, uploadBlob } from "./repo";

const MANAWEB = "app.manaweb.profile";
const BSKY = "app.bsky.actor.profile";
const SELF = "self";

// Four times the side it is drawn at, and small enough that a PDS serving the
// original costs nobody anything. A Bluesky avatar read instead runs to
// hundreds of kilobytes, which is the argument for writing our own.
const SIDE = 256;

type Wearing = { value: { avatar?: BlobRef } };

// Ours, then a Bluesky profile in the same repo, then nothing: an account made
// to use Manaweb has neither, which is what the initial stands in for.
export async function avatar(session: OAuthSession): Promise<Blob | null> {
  const ref = (await worn(session, MANAWEB)) ?? (await worn(session, BSKY));
  if (!ref) return null;

  const response = await session.fetchHandler(
    `/xrpc/com.atproto.sync.getBlob?did=${session.did}&cid=${ref.ref.$link}`,
  );
  return response.ok ? await response.blob() : null;
}

export async function wear(session: OAuthSession, file: File): Promise<void> {
  const ref = await uploadBlob(session, await square(file));
  await put(session, MANAWEB, SELF, { avatar: ref });
}

// The record is the avatar, so removing one is removing the other.
export function bare(session: OAuthSession): Promise<unknown> {
  return remove(session, MANAWEB, SELF);
}

// A repo without the record is the ordinary case rather than a fault, and
// getRecord says so with a name rather than a status.
async function worn(
  session: OAuthSession,
  collection: string,
): Promise<BlobRef | null> {
  try {
    const got = await query<Wearing>(session, "com.atproto.repo.getRecord", {
      repo: session.did,
      collection,
      rkey: SELF,
    });
    return got.value.avatar ?? null;
  } catch (error) {
    if (error instanceof Error && error.name === "RecordNotFound") return null;
    throw error;
  }
}

// Center-cropped and shrunk in the browser, so what the repo holds is already
// the size it is shown at rather than whatever came off a camera.
async function square(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIDE;
  canvas.height = SIDE;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("this browser draws no canvas");
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    SIDE,
    SIDE,
  );
  bitmap.close();

  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (out) => (out ? resolve(out) : reject(new Error("nothing to upload"))),
      "image/webp",
      0.85,
    );
  });
}
