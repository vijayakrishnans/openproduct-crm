// The demo, wearing a visitor's brand: their name, logo and colour in place of
// BrokeCRM's. It comes from two places, both on this device only:
//
// - the address: /?demo&name=Acme%20CRM&color=%23ff6600&logo=https://…
//   (a link that can be shared; the logo must be an https URL), and
// - sessionStorage, written by the landing page's "Make it yours" form, which
//   is the only way an uploaded logo (a data: URI) reaches the demo.
//
// The address wins over sessionStorage. Nothing is sent anywhere.

export type DemoBrand = {
  name?: string;
  color?: string;
  logo?: string;
};

export const DEMO_BRAND_KEY = "brokecrm.demo-brand";

const MAX_NAME = 40;
const MAX_LOGO_CHARS = 700_000; // a data: URI of about 512 KB

const cleanName = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const name = value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return name || undefined;
};

const cleanColor = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const hex = value.trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : undefined;
};

const cleanLogo = (value: unknown, allowDataUri: boolean): string | undefined => {
  if (typeof value !== "string" || value.length > MAX_LOGO_CHARS) return undefined;
  if (
    allowDataUri &&
    /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(value)
  ) {
    return value;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
};

export const readDemoBrand = (
  search: string = window.location.search,
): DemoBrand | null => {
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(window.sessionStorage.getItem(DEMO_BRAND_KEY) ?? "{}");
  } catch {
    stored = {};
  }
  const params = new URLSearchParams(search);
  const brand: DemoBrand = {
    name: cleanName(params.get("name")) ?? cleanName(stored.name),
    color: cleanColor(params.get("color")) ?? cleanColor(stored.color),
    logo: cleanLogo(params.get("logo"), false) ?? cleanLogo(stored.logo, true),
  };
  return brand.name || brand.color || brand.logo ? brand : null;
};

// Black or white text, whichever reads better on the brand colour.
export const foregroundFor = (hex: string): string => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? "#111111" : "#ffffff";
};

// The app's buttons, links, focus rings and active tabs follow --primary.
export const applyBrandColor = (hex: string) => {
  const fg = foregroundFor(hex);
  const style = document.createElement("style");
  style.id = "demo-brand";
  style.textContent = `:root, .dark {
  --primary: ${hex};
  --primary-foreground: ${fg};
  --ring: ${hex};
  --sidebar-primary: ${hex};
  --sidebar-primary-foreground: ${fg};
}`;
  document.head.appendChild(style);
};
