/** Shared comparison for names and identifiers; identifiers remain strings. */
export function normalizeInventorySearchText(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
}
