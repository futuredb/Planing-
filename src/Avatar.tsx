import type { Member } from './types'
import { endMemberDrag, memberAvatar, startMemberDrag } from './member'

export function Avatar({
  member,
  size = 'md',
  current = false,
  draggable = false,
  onPick,
  fromItemId,
  onDragEnd,
}: {
  member: Member
  size?: 'sm' | 'md' | 'lg' | 'card'
  current?: boolean
  draggable?: boolean
  onPick?: () => void
  fromItemId?: string
  onDragEnd?: () => void
}) {
  const className = `face ${size}${current ? ' current' : ''}`

  if (!onPick && !draggable) {
    return (
      <span className={className} title={member.name} role="img" aria-label={member.name}>
        <img src={memberAvatar(member)} alt="" draggable={false} />
      </span>
    )
  }

  return (
    <button
      type="button"
      className={className}
      draggable={draggable}
      onClick={onPick}
      onMouseDown={(e) => {
        if (fromItemId) e.stopPropagation()
      }}
      onDragStart={(e) => {
        if (!draggable) return
        e.stopPropagation()
        startMemberDrag(e, member.id, fromItemId)
      }}
      onDragEnd={() => {
        endMemberDrag()
        onDragEnd?.()
      }}
      title={draggable ? `Перетащить ${member.name} на карточку` : member.name}
      aria-label={draggable ? `Перетащить ${member.name} на карточку` : member.name}
    >
      <img src={memberAvatar(member)} alt="" draggable={false} />
    </button>
  )
}
