import { useState } from "react";
import { X } from "lucide-react";

// The demo's way out: whoever likes what they see can ask for it with their
// own name, logo and colours, or go back and try another brand.
export const CONTACT_EMAILS = [
  "vijayakrishnan.kartha@orunbase.com",
  "vijayakrishnan12994@gmail.com",
];

export const ContactCard = ({ brandName }: { brandName?: string }) => {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const subject = encodeURIComponent(
    brandName ? `${brandName}: a CRM for our team` : "BrokeCRM for our team",
  );
  return (
    <aside
      aria-label="Get this CRM for your team"
      // On phones the app has a bottom menu (3.5rem, with a + button that
      // rises above it): the card sits clear of it, and is shorter.
      className="fixed bottom-20 md:bottom-4 right-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-lg border bg-card text-card-foreground shadow-lg p-3 md:p-4 text-sm"
    >
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Close"
        className="absolute top-2 right-2 rounded p-1 text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" />
      </button>
      <p className="font-semibold mb-1 pr-6">
        {brandName
          ? `Want ${brandName} for real?`
          : "Want it with your own name, logo and colours?"}
      </p>
      <p className="hidden md:block text-muted-foreground mb-3">
        {brandName
          ? "This is BrokeCRM wearing your brand, on made-up data. We can set it up for your team."
          : "BrokeCRM can wear your brand. Try it in the demo, then ask us to set it up for your team."}
      </p>
      <p className="mb-2 md:mb-3">
        Write to{" "}
        {CONTACT_EMAILS.map((email, i) => (
          <span key={email}>
            {i > 0 ? " or " : null}
            <a
              href={`mailto:${email}?subject=${subject}`}
              className="underline hover:no-underline break-all"
            >
              {email}
            </a>
          </span>
        ))}
        .
      </p>
      <a
        href="/#brand"
        className="inline-block rounded-md bg-primary text-primary-foreground px-3 py-1.5 font-medium no-underline"
      >
        {brandName ? "Try another brand" : "Make it yours"}
      </a>
    </aside>
  );
};
