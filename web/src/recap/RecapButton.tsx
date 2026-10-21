// "Match recap" in the Moments panel (SPEC 6, 7): asks for the end-of-match recap and scrolls
// to it. Its own module: ui/Live.tsx renders it, and the recap panel reads ui/Live.tsx.

import type { MatchSession } from "../match/matchSession";
import { useView } from "../session";
import { useStore } from "../store/store";

export function RecapButton() {
  const session = useView();
  if (session.kind !== "match") return null;
  return <AskButton session={session} />;
}

function AskButton({ session }: { session: MatchSession }) {
  const { recap } = session;
  const status = useStore(recap.state, (s) => s.status);
  return (
    <button
      type="button"
      className="btn"
      onClick={() => {
        if (status === "idle" || status === "failed") void recap.request();
        document.getElementById("recap")?.scrollIntoView({ behavior: "smooth" });
      }}
    >
      Match recap
    </button>
  );
}
