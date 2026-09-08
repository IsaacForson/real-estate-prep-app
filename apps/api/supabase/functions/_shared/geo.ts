/**
 * Coarse region from edge headers. SPEC §5.3 flags "> 3 geographic regions in 24 h". We only
 * ever store a country/region key, never an ip. When no header is present the key is "unknown",
 * which the sql heuristic ignores so a missing header can never trigger a flag.
 *
 * Header availability depends on what fronts the edge runtime; the list below covers cloudflare
 * (cf-ipcountry / cf-region-code), vercel and generic reverse proxies. Verify on the hosted
 * project by logging `Object.fromEntries(req.headers)` once.
 */
export function regionFromHeaders(headers: Headers): string {
  const country = first(headers, ["cf-ipcountry", "x-vercel-ip-country", "x-country-code", "x-geo-country"]);
  if (!country || country === "XX" || country === "T1") return "unknown";
  const region = first(headers, ["cf-region-code", "x-vercel-ip-country-region", "x-region-code", "x-geo-region"]);
  return region ? `${country}-${region}`.toUpperCase() : country.toUpperCase();
}

function first(headers: Headers, names: string[]): string | null {
  for (const n of names) {
    const v = headers.get(n);
    if (v && v.trim() !== "") return v.trim();
  }
  return null;
}

/** Client ip as seen by the proxy, for hashing only. */
export function clientIp(headers: Headers): string | null {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("cf-connecting-ip") ?? headers.get("x-real-ip");
}
