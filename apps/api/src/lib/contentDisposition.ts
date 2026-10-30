/**
 * Builds a Content-Disposition header value for a user-supplied filename.
 *
 * The filename comes straight from the uploader, so it can contain anything.
 * Interpolating it into `filename="..."` broke in two ways:
 *   - a non-Latin-1 name (an Arabic filename, routine for Bahraini documents)
 *     makes Node throw ERR_INVALID_CHAR, so the download is a 500;
 *   - a `"` closes the quoted string, letting the uploader append their own
 *     parameters (`a"; filename=evil.html`).
 *
 * The result has an ASCII-only `filename` fallback with quotes, backslashes,
 * control characters and non-ASCII replaced by `_`, plus an RFC 5987
 * `filename*` carrying the exact name percent-encoded as UTF-8. Every
 * character of the value is printable ASCII, so it is always a legal header.
 */
export function contentDisposition(type: "inline" | "attachment", fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_") || "download";
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
