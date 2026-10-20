export function isWorkspaceOwner(
  user: {
    emailAddresses: Array<{
      emailAddress: string;
      verification: { status: string } | null;
    }>;
  } | null,
  ownerEmail?: string,
): boolean {
  return (
    !!ownerEmail &&
    !!user?.emailAddresses.some(
      (email) =>
        email.verification?.status === "verified" &&
        email.emailAddress.toLowerCase() === ownerEmail.trim().toLowerCase(),
    )
  );
}
