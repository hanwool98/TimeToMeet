export interface RepresentativeCrop {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * offsetX/offsetY are stored as fractions of the box they were captured in
 * (not absolute pixels), so the same crop renders consistently at any target
 * size — the full-screen editor, a large static preview, or a tiny avatar.
 *
 * Applications submitted before this fraction-based scheme stored raw pixel
 * deltas under the same field names. Those old values would otherwise be
 * misread as huge fractions and push the photo entirely out of frame, so
 * offsets are clamped to a generous-but-bounded range as a safety net for
 * that legacy data — new submissions never come close to this range.
 */
export function representativeCropTransform(crop: RepresentativeCrop | null | undefined, boxSizePx: number) {
  const scale = crop?.scale ?? 1;
  const clampedOffsetX = Math.max(-3, Math.min(3, crop?.offsetX ?? 0));
  const clampedOffsetY = Math.max(-3, Math.min(3, crop?.offsetY ?? 0));
  const x = clampedOffsetX * boxSizePx;
  const y = clampedOffsetY * boxSizePx;
  return {
    transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${scale})`,
  };
}
