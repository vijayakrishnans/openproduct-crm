import { openUrl } from "../lib/platform";

const URL_RE = /(https?:\/\/[^\s"'<>)]+)/g;

/** Text with every web address made clickable (opens the system browser). */
export function Linkify({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} href={p} onClick={(e) => (e.preventDefault(), void openUrl(p))}>{p}</a>
        ) : (
          p
        ),
      )}
    </>
  );
}
