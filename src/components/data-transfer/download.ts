import type { Envelope } from './types';

/**
 * Fetching a file the server may refuse.
 *
 * Navigating straight to the URL would be simpler, but an export past the row
 * cap answers with the JSON error envelope — and a browser told to navigate
 * there renders raw JSON in a blank tab instead of showing the operator why the
 * download did not happen. Fetching lets the two outcomes be told apart.
 */

/** Pulls the filename out of a `Content-Disposition` header. */
function filenameFrom(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match?.[1] ? decodeURIComponent(match[1]) : fallback;
}

/**
 * Downloads `url`, or throws with the server's own message.
 *
 * @throws {Error} Carrying the envelope's message, ready to show in a toast.
 */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const response = await fetch(url);
  const contentType = response.headers.get('content-type') ?? '';

  if (!response.ok || contentType.includes('application/json')) {
    const payload = (await response
      .json()
      .catch(() => null)) as Envelope<unknown> | null;
    throw new Error(payload?.message ?? 'Unduhan gagal. Coba lagi.');
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filenameFrom(
      response.headers.get('content-disposition'),
      fallbackName,
    );
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoked on the next tick: revoking synchronously can beat the browser to
    // the click it was handed.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}
