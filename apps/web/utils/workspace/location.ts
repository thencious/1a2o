export function workspaceSection(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return pathname;
  if (["settings", "shared", "accounts", "organization"].includes(parts[0]))
    return `/${parts[0]}`;
  if (parts[1] === "assistant" && parts[2] === "rule")
    return `/${parts[0]}/automation`;
  return `/${parts.slice(0, 2).join("/")}`;
}
export function rememberedWorkspaceHref(
  href: string,
  locations: ReadonlyMap<string, string>,
) {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const pathname = href.split(/[?#]/, 1)[0];
  return locations.get(workspaceSection(pathname)) ?? href;
}
