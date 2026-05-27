import { canonicalize } from '@yacad/canonical';
import { hashCanonical, type Hash, type Hasher } from '@yacad/hash';
import type { LuaDefinition } from './schema';

/** Canonical string form of a definition — sorted keys, byte-stable. */
export function canonicalizeDefinition(def: LuaDefinition): string {
  return canonicalize(def);
}

/** Definition hash — pure function of canonicalize(def). Delegates to the
 *  existing `hashCanonical` helper in @yacad/hash so we don't duplicate the
 *  TextEncoder + hash plumbing. */
export function hashLuaDefinition(def: LuaDefinition, hasher: Hasher): Promise<Hash> {
  return hashCanonical(def, hasher);
}
