/** Small deterministic PDFs with accurate byte offsets and xref. */
export function passportPdf(options: { pages?: number; damagedPage?: number; padding?: number } = {}): Uint8Array {
  const pages = options.pages ?? 1;
  let document = "%PDF-1.7\n";
  const offsets = [0];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pages} >>`,
  ];
  for (let page = 1; page <= pages; page++) {
    const damaged = options.damagedPage === page;
    const content = damaged ? "not-a-deflate-stream" : " ".repeat(page === 1 ? options.padding ?? 0 : 0);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents ${4 + (page - 1) * 2} 0 R >>`,
      `<< /Length ${content.length}${damaged ? " /Filter /FlateDecode" : ""} >>\nstream\n${content}\nendstream`,
    );
  }
  for (let index = 0; index < objects.length; index++) {
    offsets.push(document.length);
    document += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = document.length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(document);
}
