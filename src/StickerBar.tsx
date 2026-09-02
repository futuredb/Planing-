import { useEffect, useMemo, useRef, useState } from 'react'
import { STICKERS, stickerById, type StickerId } from './stickers'
import { useStore } from './store-context'
import type { Item } from './types'
import { Icon } from './ui/Icon'

export function ReactionBar({ item, compact = false }: { item: Item; compact?: boolean }) {
  const { state, toggleReaction } = useStore()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => {
    const result = new Map<StickerId, { count: number; mine: boolean }>()
    for (const placed of item.stickers ?? []) {
      const current = result.get(placed.sticker) ?? { count: 0, mine: false }
      result.set(placed.sticker, {
        count: current.count + 1,
        mine: current.mine || placed.by === state.currentMemberId,
      })
    }
    return STICKERS.filter((sticker) => result.has(sticker.id)).map((sticker) => ({
      ...sticker,
      ...result.get(sticker.id)!,
    }))
  }, [item.stickers, state.currentMemberId])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`reaction-wrap${compact ? ' compact' : ''}`} ref={root}>
      <div className="reaction-list">
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            className={`reaction-chip${group.mine ? ' mine' : ''}`}
            onClick={() => toggleReaction(item.id, group.id)}
            title={`${group.label}: ${group.count}`}
            aria-label={`${group.label}, реакций: ${group.count}`}
          >
            <img src={group.src} alt="" />
            {group.count > 1 ? <span>{group.count}</span> : null}
          </button>
        ))}
        <button
          type="button"
          className="reaction-add"
          onClick={() => setOpen((value) => !value)}
          aria-label="Добавить реакцию"
          aria-expanded={open}
        >
          <Icon name="reaction" size={compact ? 15 : 17} />
        </button>
      </div>
      {open ? (
        <div className="reaction-popover" role="menu" aria-label="Выберите реакцию">
          {STICKERS.map((sticker) => {
            const mine = item.stickers?.some(
              (placed) => placed.sticker === sticker.id && placed.by === state.currentMemberId,
            )
            return (
              <button
                key={sticker.id}
                type="button"
                className={mine ? 'selected' : ''}
                onClick={() => {
                  toggleReaction(item.id, sticker.id)
                  setOpen(false)
                }}
                title={sticker.label}
                role="menuitem"
              >
                <img src={stickerById(sticker.id).src} alt={sticker.label} />
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
