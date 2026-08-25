import type { DragEvent } from 'react'
import { beginDetach, markDropConsumed } from './detach'
import type { PlacedSticker } from './types'

export const STICKERS = [
  { id: 'heart', label: 'сердце', src: '/stickers/heart.svg' },
  { id: 'star', label: 'звезда', src: '/stickers/star.svg' },
  { id: 'money', label: 'деньги', src: '/stickers/money.svg' },
  { id: 'question', label: 'вопрос', src: '/stickers/question.svg' },
  { id: 'lightning', label: 'молния', src: '/stickers/lightning.svg' },
  { id: 'cry', label: 'плачет', src: '/stickers/cry.svg' },
  { id: 'fire', label: 'огонь', src: '/stickers/fire.svg' },
  { id: 'sleep', label: 'спит', src: '/stickers/sleep.svg' },
  { id: 'up', label: 'палец вверх', src: '/stickers/up.svg' },
  { id: 'down', label: 'палец вниз', src: '/stickers/down.svg' },
] as const

export type StickerId = (typeof STICKERS)[number]['id']

const STICKER_MIME = 'text/x-sticker'
const PLACED_MIME = 'text/x-sticker-placed'

export function stickerById(id: StickerId) {
  return STICKERS.find((s) => s.id === id)!
}

export function startStickerDrag(event: DragEvent, id: StickerId) {
  event.dataTransfer.setData(STICKER_MIME, id)
  event.dataTransfer.setData('text/plain', `sticker:${id}`)
  event.dataTransfer.effectAllowed = 'copy'
}

export function startPlacedStickerDrag(
  event: DragEvent,
  placed: PlacedSticker,
  itemId: string,
) {
  startStickerDrag(event, placed.sticker)
  event.dataTransfer.setData(
    PLACED_MIME,
    JSON.stringify({
      placedId: placed.id,
      fromItem: itemId,
      rot: placed.rot,
      scale: placed.scale,
    }),
  )
  beginDetach({ kind: 'sticker', itemId, placedId: placed.id })
  event.dataTransfer.effectAllowed = 'copyMove'
}

export function readPlacedSticker(event: DragEvent) {
  const raw = event.dataTransfer.getData(PLACED_MIME)
  if (!raw) return null
  try {
    return JSON.parse(raw) as {
      placedId: string
      fromItem: string
      rot: number
      scale: number
    }
  } catch {
    return null
  }
}

export function readStickerDrop(event: DragEvent) {
  const typed = event.dataTransfer.getData(STICKER_MIME)
  if (typed) return typed as StickerId
  const plain = event.dataTransfer.getData('text/plain')
  if (plain.startsWith('sticker:')) return plain.slice(8) as StickerId
  return null
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function randomStickerPlace(
  drop?: { x: number; y: number; w: number; h: number },
  jitter = 11,
) {
  let x = 8 + Math.random() * 70
  let y = 8 + Math.random() * 58
  if (drop && drop.w > 8 && drop.h > 8) {
    x = (drop.x / drop.w) * 100 + (Math.random() * jitter * 2 - jitter)
    y = (drop.y / drop.h) * 100 + (Math.random() * jitter * 2 - jitter)
  }
  return {
    x: clamp(x, 2, 78),
    y: clamp(y, 2, 70),
    rot: Math.random() * 42 - 21,
    scale: 0.82 + Math.random() * 0.45,
  }
}

export type StickerFrom = {
  itemId: string
  placedId: string
  rot: number
  scale: number
}

export function stickerDropBind(
  onStick: (
    sticker: StickerId,
    place: ReturnType<typeof randomStickerPlace>,
    from?: StickerFrom,
  ) => void,
) {
  return {
    onDragOver: (event: DragEvent) => {
      if (
        ![...event.dataTransfer.types].some(
          (t) => t === STICKER_MIME || t === PLACED_MIME || t === 'text/plain',
        )
      ) {
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },
    onDrop: (event: DragEvent) => {
      const sticker = readStickerDrop(event)
      if (!sticker || !STICKERS.some((s) => s.id === sticker)) return
      event.preventDefault()
      event.stopPropagation()
      markDropConsumed()
      const placed = readPlacedSticker(event)
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      const place = randomStickerPlace(
        {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          w: rect.width,
          h: rect.height,
        },
        placed ? 4 : 11,
      )
      onStick(
        sticker,
        placed ? { ...place, rot: placed.rot, scale: placed.scale } : place,
        placed
          ? {
              itemId: placed.fromItem,
              placedId: placed.placedId,
              rot: placed.rot,
              scale: placed.scale,
            }
          : undefined,
      )
    },
  }
}
