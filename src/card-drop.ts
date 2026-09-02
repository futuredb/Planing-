import type { DragEvent } from 'react'
import { memberDropBind } from './member'
import { stickerDropBind, type StickerId } from './stickers'

export function cardDropBind(
  onAssign: (memberId: string, fromItemId?: string | null) => void,
  onReaction: (sticker: StickerId) => void,
) {
  const memberDrop = memberDropBind(onAssign)
  const stickerDrop = stickerDropBind((sticker) => onReaction(sticker))

  return {
    onDragEnter: (event: DragEvent) => {
      memberDrop.onDragEnter(event)
      stickerDrop.onDragEnter(event)
    },
    onDragOver: (event: DragEvent) => {
      memberDrop.onDragOver(event)
      stickerDrop.onDragOver(event)
    },
    onDragLeave: (event: DragEvent) => {
      memberDrop.onDragLeave(event)
      stickerDrop.onDragLeave(event)
    },
    onDrop: (event: DragEvent) => {
      memberDrop.onDrop(event)
      if (!event.defaultPrevented) stickerDrop.onDrop(event)
    },
  }
}
