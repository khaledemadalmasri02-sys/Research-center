// Minimal, dependency-free PDF writer for plain-text CRF / reports.
// Produces a valid single-page PDF (Helvetica) from an array of text lines.
// Pure + exported so it can be unit-tested without a PDF library.

function escapePdfText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    // strip non-ASCII / control chars that WinAnsi can't represent simply
    .replace(/[^\x20-\x7e]/g, "?");
}

export function buildSimplePdf(lines: string[], title = "Report"): Uint8Array {
  const safeTitle = escapePdfText(title);
  const content: string[] = ["BT", "/F1 12 Tf", "50 740 Td", "16 TL"];
  content.push(`(${safeTitle}) Tj T*`);
  content.push(`(Generated: ${new Date().toISOString()}) Tj T*`);
  content.push(`(----------------------------------------) Tj T*`);
  for (const line of lines) {
    content.push(`(${escapePdfText(line)}) Tj T*`);
  }
  content.push("ET");
  const stream = content.join("\n");

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf += xref;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}
