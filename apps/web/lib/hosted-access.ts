// Hosted access is shared: every authenticated Clerk user has the same access.
// Only pass the user returned by Clerk's server-side currentUser().
export function canAccessWorkspace(user: { id: string } | null): boolean {
  return Boolean(user?.id);
}
