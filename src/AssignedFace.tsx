import type { Member } from './types'
import { Avatar } from './Avatar'
import { endDetach } from './detach'
import { useStore } from './store-context'

export function AssignedFace({
  itemId,
  member,
}: {
  itemId: string
  member: Member
}) {
  const { assignItem, peelSticker } = useStore()
  return (
    <Avatar
      member={member}
      size="card"
      draggable
      fromItemId={itemId}
      onDragEnd={() =>
        endDetach({
          peelSticker,
          unassign: (id) => assignItem(id, null),
        })
      }
    />
  )
}
