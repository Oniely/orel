export interface TabSlot {
  id: string;
  /** Left edge of the tab's resting slot, in its normal (untransformed) layout. */
  left: number;
  width: number;
}

/**
 * Given every tab's resting slot and where the dragged tab currently is (visually,
 * including whatever offset it has been dragged by), returns the id of the tab whose
 * current array position the dragged tab should move to, or null if it hasn't moved
 * out of its own slot yet.
 *
 * The result is meant to be passed straight to the `moveTab(draggedId, targetId)` store
 * action, which removes the dragged tab and re-inserts it at the target's *original*
 * index. That means: counting how many other tabs the dragged tab's center has moved
 * past gives exactly the dragged tab's desired final index — so the tab currently
 * sitting at that index (in the full, untouched array) is always the correct target,
 * regardless of drag direction or how many slots were crossed in one move. This lets a
 * single call land a fast, multi-slot drag precisely instead of cascading swaps.
 *
 * Positions must come from layout-only measurements (e.g. `offsetLeft`/`offsetWidth`),
 * never `getBoundingClientRect()` on elements that may have a CSS transform applied
 * (drag lift, FLIP reorder animation, etc.) — a transform would feed a moving target
 * back into this calculation and produce runaway reordering.
 */
export function computeDragReorderTarget(
  slots: TabSlot[],
  draggedId: string,
  draggedCenter: number,
): string | null {
  const draggedIndex = slots.findIndex((slot) => slot.id === draggedId);
  if (draggedIndex === -1) return null;

  let finalIndex = 0;
  for (const slot of slots) {
    if (slot.id === draggedId) continue;
    const slotCenter = slot.left + slot.width / 2;
    if (slotCenter < draggedCenter) finalIndex++;
  }

  if (finalIndex === draggedIndex) return null;
  return slots[finalIndex].id;
}
