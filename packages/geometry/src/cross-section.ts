/** A point or vector in 2D space (XY plane). */
export type Vec2 = readonly [number, number];

/**
 * A 2D region defined by one or more closed simple polygons. Outer polygons
 * are CCW; holes are CW (matches Manifold's CrossSection convention). Plain
 * nested arrays so structured-clone moves it cleanly through postMessage.
 */
export interface CrossSection {
  readonly polygons: ReadonlyArray<ReadonlyArray<Vec2>>;
}

/** The canonical empty cross-section (no polygons). */
export function emptyCrossSection(): CrossSection {
  return { polygons: [] };
}
