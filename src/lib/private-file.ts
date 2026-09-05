export function privateFileUrl(path: "/media" | "/scene" | "/repair-scene", id: string): URL {
  const configured = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  const deployment = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (configured) return new URL(`${path}?${new URLSearchParams({ id })}`, configured);
  if (deployment) {
    const url = new URL(deployment);
    if (url.hostname.endsWith(".convex.cloud")) {
      url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
      url.pathname = path;
      url.search = new URLSearchParams({ id }).toString();
      return url;
    }
  }
  throw new Error("Private file delivery needs the deployment's Convex site URL configuration.");
}
