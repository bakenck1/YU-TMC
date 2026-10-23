/** Codes are text identifiers: leading zeros and every character are significant. */
export function exactMaterialCode(value: string | null | undefined): string | null {
  const code = value?.normalize("NFKC").trim();
  return code && code.length <= 64 && !/[\u0000-\u001f\u007f]/u.test(code) ? code : null;
}

export function isTemporaryOneCCard(kind: string, number: string): boolean {
  return kind === "temporary" || /^TMP-/iu.test(number);
}
