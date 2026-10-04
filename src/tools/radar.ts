// Thin wrapper around Cloudflare Radar outage annotations.
export type Outage = {
  start?: string;
  end?: string | null;
  cause?: string;
  type?: string;
  where?: string[];
  networks?: string[];
  description?: string;
  source?: string | null;
};

export async function fetchOutages(token: string, country: string, days: number): Promise<Outage[]> {
  const url = new URL("https://api.cloudflare.com/client/v4/radar/annotations/outages");
  url.searchParams.set("location", country.toUpperCase());
  url.searchParams.set("dateRange", `${days}d`);
  url.searchParams.set("limit", "10");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Radar API error ${res.status}`);
  const body = (await res.json()) as any;
  const items: any[] = body?.result?.annotations ?? [];

  return items.map((a) => {
    const places = (a.locationsDetails ?? []).map((l: any) => l.name);
    const asnPlaces = (a.asnsDetails ?? []).map((n: any) => n.location?.name);
    return {
      start: a.startDate,
      end: a.endDate,
      cause: a.outage?.outageCause,
      type: a.outage?.outageType,
      where: Array.from(new Set<string>([...places, ...asnPlaces].filter(Boolean))),
      networks: (a.asnsDetails ?? []).map((n: any) => n.name).slice(0, 5),
      description: a.description,
      source: a.linkedUrl,
    };
  });
}

export function summarize(outages: Outage[]): string {
  if (!outages.length) return "No outages reported.";
  const o = outages[0];
  return `${outages.length} outage(s); latest started ${o.start ?? "unknown"} (${o.cause ?? "cause unknown"}).`;
}