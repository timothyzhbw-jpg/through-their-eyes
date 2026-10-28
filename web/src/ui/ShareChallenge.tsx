// "Challenge a friend" (SPEC 7): on a result screen of Your turn (Your call, the academy drill), a
// quiet button that sends the mode's link: the device's share sheet where there is one, else the
// link copied to the clipboard, said in a status next to the button. The link keeps the page's
// match, moment and settings (withPageAction). A cancelled share changes nothing; a share that
// fails otherwise copies the link, and a refused clipboard shows the link to copy by hand.

import { useState } from "react";
import { withPageAction } from "../doors/doors";

/** The address of `action` on this page: the site's root, the page's query and the action. */
export function challengeUrl(
  action: string,
  location: Pick<Location, "origin" | "search"> = window.location,
): string {
  return `${location.origin}${import.meta.env.BASE_URL}${withPageAction(location.search, action)}`;
}

export function ShareChallenge({ action, text }: { action: string; text: string }) {
  // What the status says: the link copied, or the link itself when nothing could send it.
  const [status, setStatus] = useState<{ copied: boolean; url: string | null }>({
    copied: false,
    url: null,
  });
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setStatus({ copied: true, url: null });
    } catch {
      setStatus({ copied: false, url }); // a refused clipboard: the link to copy by hand
    }
  };
  const share = async () => {
    setStatus({ copied: false, url: null });
    const url = challengeUrl(action);
    if (typeof navigator.share !== "function") return copy(url);
    try {
      await navigator.share({ title: "Through Their Eyes", text, url });
    } catch (e) {
      // A share sheet closed without sharing changes nothing; any other failure copies instead.
      if ((e as { name?: string } | null)?.name !== "AbortError") await copy(url);
    }
  };
  // One item in the actions' row, so the empty status adds no gap.
  return (
    <span className="share-challenge">
      <button type="button" className="btn btn-quiet" onClick={() => void share()}>
        Challenge a friend
      </button>{" "}
      <span className="share-status" role="status" style={{ overflowWrap: "anywhere" }}>
        {status.copied ? "Link copied" : status.url ? `Copy this link: ${status.url}` : ""}
      </span>
    </span>
  );
}
