const encoder = new TextEncoder();

/**
 * Compares the shared secret without leaking its length or content through
 * timing. Kept deliberately simple: this migration preserves the existing
 * shared-secret gate rather than replacing the auth model.
 */
export function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = encoder.encode(provided);
  const b = encoder.encode(expected);
  if (a.byteLength !== b.byteLength) {
    // Do the same work regardless, so a wrong length is not faster to detect.
    crypto.subtle.timingSafeEqual(b, b);
    return false;
  }
  return crypto.subtle.timingSafeEqual(a, b);
}
