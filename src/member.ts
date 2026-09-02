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
  document.documentElement.classList.add('member-drag-active')
}

export function endMemberDrag() {
  document.documentElement.classList.remove('member-drag-active')
  document.querySelectorAll('.member-drop-over').forEach((element) => {
    element.classList.remove('member-drop-over')
  })
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
  function isMemberDrag(event: DragEvent) {
    return Array.from(event.dataTransfer.types).some(
      (type) => type === MEMBER_MIME || type === 'text/plain',
    )
  }

  return {
    onDragEnter: (event: DragEvent) => {
      if (!isMemberDrag(event)) return
      event.currentTarget.classList.add('member-drop-over')
    },
    onDragOver: (event: DragEvent) => {
      if (!isMemberDrag(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (event: DragEvent) => {
      const next = event.relatedTarget
      if (next instanceof Node && event.currentTarget.contains(next)) return
      event.currentTarget.classList.remove('member-drop-over')
    },
    onDrop: (event: DragEvent) => {
      const memberId = readMemberDrop(event)
      if (!memberId) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.classList.remove('member-drop-over')
      markDropConsumed()
      onAssign(memberId, readMemberFromItem(event) || null)
    },
  }
}
