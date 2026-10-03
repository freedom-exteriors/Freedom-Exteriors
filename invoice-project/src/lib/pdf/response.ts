import "server-only";

/** PDF bytes → a no-cache response the browser can download or share. */
export function pdfResponse(buf: Buffer, fileName: string, download: boolean) {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
