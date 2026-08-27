export interface AutomaticYessenovLoginInput {
  enabled: boolean;
  manualLogin: boolean;
  error?: string;
  returnTo?: string;
}

export function automaticYessenovLoginTarget({
  enabled,
  manualLogin,
  error,
  returnTo,
}: AutomaticYessenovLoginInput): string | null {
  if (!enabled || manualLogin || error) return null;

  const search = returnTo
    ? `?${new URLSearchParams({ returnTo }).toString()}`
    : "";
  return `/api/auth/yessenov${search}`;
}
