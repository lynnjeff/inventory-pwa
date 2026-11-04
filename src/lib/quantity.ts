/** Delta for a typed quantity edit, measured from the quantity the form loaded. */
export function typedQuantityDelta(loaded: number, typed: number): number {
  return typed - loaded
}
