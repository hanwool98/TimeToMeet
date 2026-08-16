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
 * A crop box rendered at `scale` only has (scale - 1) / 2 box-widths of slack
 * on each side before it exposes empty space, so any offset beyond that bound
 * is geometrically impossible for a crop actually captured against this box —
 * either older raw-pixel data from before the fraction-based scheme, or a
 * scale that changed after the offset was set. Clamping to that bound keeps
 * every crop centered on real image content instead of sliding off-frame.
 */
export function representativeCropTransform(crop: RepresentativeCrop | null | undefined, boxSizePx: number) {
  const scale = crop?.scale ?? 1;
  const maxOffsetFraction = Math.max(0, (scale - 1) / 2);
  const clampedOffsetX = Math.max(-maxOffsetFraction, Math.min(maxOffsetFraction, crop?.offsetX ?? 0));
  const clampedOffsetY = Math.max(-maxOffsetFraction, Math.min(maxOffsetFraction, crop?.offsetY ?? 0));
  const x = clampedOffsetX * boxSizePx;
  const y = clampedOffsetY * boxSizePx;
  return {
    transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${scale})`,
  };
}
