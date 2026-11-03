/** Both legacy sequential and current random temporary numbers use this reserved prefix. */
export function isTemporaryInventoryNumber(value: string): boolean {
  return /^TMP-/iu.test(value.normalize("NFKC").trim());
}
