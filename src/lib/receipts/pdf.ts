/**
 * Receipt PDF. A plain, printable A5 page built with pdf-lib (pure JS, no
 * native dependencies, works on Vercel). Edit the layout here to rebrand.
 */
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

export type ReceiptData = {
  businessName: string;
  supportEmail: string;
  receiptNumber: string;
  issuedAt: Date;
  customerName: string | null;
  customerEmail: string | null;
  description: string;
  /** e.g. "21 Nov 2026 to 21 Dec 2026" for a subscription period. */
  period?: string;
  amountKes: number;
  mpesaReceipt: string | null;
  /** Already masked for display, e.g. 0712 ••• 678. */
  phoneMasked: string | null;
  accountRef: string;
};

const A5: [number, number] = [419.53, 595.28];

/** pdf-lib's standard fonts are WinAnsi only; replace characters they can't draw. */
function safe(text: string): string {
  return text.replace(/•/g, "*").replace(/[^\x20-\x7E -ÿ]/g, "?");
}

export async function buildReceiptPdf(data: ReceiptData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Receipt ${data.receiptNumber}`);
  pdf.setAuthor(data.businessName);
  const page = pdf.addPage(A5);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const grey = rgb(0.4, 0.4, 0.4);
  const margin = 36;
  const width = A5[0] - margin * 2;
  let y = A5[1] - margin;

  const line = (
    text: string,
    opts: { size?: number; font?: typeof regular; color?: ReturnType<typeof rgb>; gap?: number } = {},
  ) => {
    const size = opts.size ?? 10;
    y -= size + (opts.gap ?? 6);
    page.drawText(safe(text), { x: margin, y, size, font: opts.font ?? regular, color: opts.color ?? rgb(0, 0, 0) });
  };
  const row = (label: string, value: string) => {
    y -= 18;
    page.drawText(safe(label), { x: margin, y, size: 10, font: regular, color: grey });
    const v = safe(value);
    page.drawText(v, { x: margin + width - bold.widthOfTextAtSize(v, 10), y, size: 10, font: bold });
  };
  const rule = () => {
    y -= 10;
    page.drawLine({
      start: { x: margin, y },
      end: { x: margin + width, y },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.85),
    });
  };

  line(data.businessName, { size: 18, font: bold, gap: 0 });
  line("Payment receipt", { size: 11, color: grey });
  rule();

  row("Receipt number", data.receiptNumber);
  row(
    "Date",
    new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" }).format(
      data.issuedAt,
    ),
  );
  if (data.customerName) row("Billed to", data.customerName);
  if (data.customerEmail) row(data.customerName ? "" : "Billed to", data.customerEmail);
  rule();

  row("Description", data.description);
  if (data.period) row("Period", data.period);
  row("Account number", data.accountRef);
  rule();

  y -= 8;
  row("Amount paid", `KES ${new Intl.NumberFormat("en-KE").format(data.amountKes)}`);
  row("Paid with", "M-Pesa");
  if (data.mpesaReceipt) row("M-Pesa reference", data.mpesaReceipt);
  if (data.phoneMasked) row("Phone", data.phoneMasked);
  rule();

  y = margin + 24;
  page.drawText(safe(`Questions? ${data.supportEmail}`), { x: margin, y, size: 9, font: regular, color: grey });

  return pdf.save();
}
