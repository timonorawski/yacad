import { canonicalBytes } from '@yacad/canonical';

/** A lowercase hex digest string. */
export type Hash = string;

/**
 * Pluggable content hasher. SHA-256 is the POC default; blake3 is expected to
 * replace it later (vision §Open Questions) without touching call sites — only
 * the algorithm identifier and digest bytes change.
 */
export interface Hasher {
  /** Stable identifier for the algorithm, e.g. "sha-256". */
  readonly algorithm: string;
  /** Hash raw bytes to a lowercase hex digest. */
  hash(data: Uint8Array): Promise<Hash>;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += HEX[byte];
  return out;
}

/** SHA-256 via the Web Crypto API (available in browsers, workers, and Node ≥ 20). */
export class Sha256Hasher implements Hasher {
  readonly algorithm = 'sha-256';

  async hash(data: Uint8Array): Promise<Hash> {
    // Copy into a fresh ArrayBuffer-backed view so SharedArrayBuffer-backed
    // inputs don't violate SubtleCrypto's BufferSource expectations.
    const digest = await crypto.subtle.digest('SHA-256', data.slice());
    return toHex(new Uint8Array(digest));
  }
}

/** Default hasher instance for the POC. */
export const defaultHasher: Hasher = new Sha256Hasher();

/** Convenience: canonicalize a value and hash its bytes. */
export function hashCanonical(value: unknown, hasher: Hasher = defaultHasher): Promise<Hash> {
  return hasher.hash(canonicalBytes(value));
}
