export function teamRoute(teamSlug: string, path = '') {
  return `/teams/${encodeURIComponent(teamSlug)}${path}`;
}

export function teamBySlugRoute(teamSlug: string) {
  return `/teams/slug/${encodeURIComponent(teamSlug)}`;
}
