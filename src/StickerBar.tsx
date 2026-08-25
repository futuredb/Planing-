import {
  STICKERS,
  startPlacedStickerDrag,
  startStickerDrag,
  stickerById,
  readPlacedSticker,
} from './stickers'
import { endDetach, markDropConsumed } from './detach'
import { useStore } from './store'
import type { Item } from './types'

export function StickerRail() {
  const { peelSticker } = useStore()

  return (
    <aside
      className="sticker-rail"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const placed = readPlacedSticker(e)
        if (!placed) return
        e.preventDefault()
        markDropConsumed()
        peelSticker(placed.fromItem, placed.placedId)
      }}
    >
      {STICKERS.map((s) => (
        <button
          key={s.id}
          type="button"
          className="rail-sticker"
          aria-label={s.label}
          draggable
          onDragStart={(e) => startStickerDrag(e, s.id)}
        >
          <img src={s.src} alt="" />
        </button>
      ))}
    </aside>
  )
}

export function CardStickers({ item }: { item: Item }) {
  const { peelSticker, assignItem } = useStore()
  return (
    <div className="stuck-layer">
      {(item.stickers ?? []).map((placed) => {
        const s = stickerById(placed.sticker)
        return (
          <button
            key={placed.id}
            type="button"
            className="stuck"
            title={`${s.label} · стяните, чтобы снять`}
            draggable
            style={{
              left: `${placed.x}%`,
              top: `${placed.y}%`,
              transform: `rotate(${placed.rot}deg) scale(${placed.scale})`,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onDragStart={(e) => {
              e.stopPropagation()
              startPlacedStickerDrag(e, placed, item.id)
            }}
            onDragEnd={() =>
              endDetach({
                peelSticker,
                unassign: (id) => assignItem(id, null),
              })
            }
          >
            <img src={s.src} alt={s.label} draggable={false} />
          </button>
        )
      })}
    </div>
  )
}
