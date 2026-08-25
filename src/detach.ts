type Pending =
  | { kind: 'sticker'; itemId: string; placedId: string }
  | { kind: 'member'; itemId: string }

let pending: Pending | null = null
let consumed = false

export function beginDetach(next: Pending) {
  pending = next
  consumed = false
}

export function markDropConsumed() {
  consumed = true
}

export function endDetach(actions: {
  peelSticker: (itemId: string, placedId: string) => void
  unassign: (itemId: string) => void
}) {
  if (!consumed && pending) {
    if (pending.kind === 'sticker') actions.peelSticker(pending.itemId, pending.placedId)
    if (pending.kind === 'member') actions.unassign(pending.itemId)
  }
  pending = null
  consumed = false
}
