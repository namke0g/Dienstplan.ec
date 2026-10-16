export const dynamic = "force-static";
export function GET() {
  return Response.json(
    { name: "Dienstplan", short_name: "Dienstplan", start_url: "/", display: "standalone", background_color: "#ffffff", theme_color: "#2563eb", lang: "de",
      icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }] },
    { headers: { "content-type": "application/manifest+json" } },
  );
}
