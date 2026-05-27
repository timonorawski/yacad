/**
 * Canonical serialization of parameter values.
 *
 * Invariant (CLAUDE.md #4): two semantically identical parameter sets MUST
 * produce byte-identical canonical forms. The canonical string is the preimage
 * for semantic hashing, so any divergence here silently degrades cache hit
 * rates — hence the exhaustive test suite alongside this file.
 *
 * Rules:
 *  - object keys are emitted in ascending code-unit order (deterministic);
 *  - numbers use ECMAScript's shortest round-trippable form, with -0 folded to 0;
 *  - non-finite numbers (NaN, ±Infinity) are rejected — they cannot be a stable
 *    geometry parameter;
 *  - `undefined` object properties are omitted (matching JSON), but `undefined`
 *    elsewhere (array elements, top level) is rejected rather than silently
 *    coerced to null;
 *  - only plain objects (Object.prototype or null prototype) and arrays are
 *    accepted as containers — Date/Map/class instances are rejected.
 */

export class CanonicalError extends Error {
  override readonly name = 'CanonicalError';
}

const encoder = new TextEncoder();

/** Serialize a value to its canonical string form. */
export function canonicalize(value: unknown): string {
  return encode(value);
}

/** Canonical string form encoded as UTF-8 bytes — the hashing preimage. */
export function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalize(value));
}

function encode(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return numberToken(value);
    case 'string':
      // JSON.stringify gives canonical, fully-escaped, quoted strings.
      return JSON.stringify(value);
    case 'object':
      return encodeContainer(value);
    default:
      throw new CanonicalError(`cannot canonicalize value of type "${typeof value}"`);
  }
}

function numberToken(value: number): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalError(`non-finite numbers are not canonicalizable: ${String(value)}`);
  }
  // String(-0) is already "0", but be explicit so the intent is obvious.
  if (value === 0) return '0';
  return String(value);
}

function encodeContainer(value: object): string {
  if (Array.isArray(value)) {
    return `[${value.map(encodeElement).join(',')}]`;
  }

  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new CanonicalError('only plain objects and arrays are supported as containers');
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();

  const members = keys.map((key) => `${JSON.stringify(key)}:${encode(record[key])}`);
  return `{${members.join(',')}}`;
}

function encodeElement(value: unknown): string {
  if (value === undefined) {
    throw new CanonicalError('undefined is not allowed as an array element');
  }
  return encode(value);
}
