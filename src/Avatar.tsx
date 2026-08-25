import type { DragEvent } from 'react'
import type { Member } from './types'
import { beginDetach, markDropConsumed } from './detach'

const MEMBER_MIME = 'text/x-member'
const MEMBER_FROM = 'text/x-member-from'

export const DEFAULT_AVATARS: Record<string, string> = {
  m1: '/avatars/m1.png?v=2',
  m2: '/avatars/m2.png?v=2',
  m3: '/avatars/m3.png?v=2',
  m4: '/avatars/m4.png?v=2',
  m5: '/avatars/m5.png?v=2',
}

export function memberAvatar(member: Member) {
  return member.avatar || DEFAULT_AVATARS[member.id] || DEFAULT_AVATARS.m1
}

export function startMemberDrag(event: DragEvent, memberId: string, fromItemId?: string) {
  event.dataTransfer.setData(MEMBER_MIME, memberId)
  event.dataTransfer.setData('text/plain', `member:${memberId}`)
  if (fromItemId) {
    event.dataTransfer.setData(MEMBER_FROM, fromItemId)
    beginDetach({ kind: 'member', itemId: fromItemId })
  }
  event.dataTransfer.effectAllowed = 'copyMove'
}

export function readMemberFromItem(event: DragEvent) {
  return event.dataTransfer.getData(MEMBER_FROM) || null
}

export function readMemberDrop(event: DragEvent) {
  const typed = event.dataTransfer.getData(MEMBER_MIME)
  if (typed) return typed
  const plain = event.dataTransfer.getData('text/plain')
  if (plain.startsWith('member:')) return plain.slice(7)
  return null
}

export function memberDropBind(
  onAssign: (memberId: string, fromItemId?: string | null) => void,
) {
  return {
    onDragOver: (event: DragEvent) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },
    onDrop: (event: DragEvent) => {
      const memberId = readMemberDrop(event)
      if (!memberId) return
      event.preventDefault()
      event.stopPropagation()
      markDropConsumed()
      onAssign(memberId, readMemberFromItem(event) || null)
    },
  }
}

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
  return (
    <button
      type="button"
      className={`face ${size}${current ? ' current' : ''}`}
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
      onDragEnd={onDragEnd}
      title={member.name}
      aria-label={member.name}
    >
      <img src={memberAvatar(member)} alt="" draggable={false} />
    </button>
  )
}
