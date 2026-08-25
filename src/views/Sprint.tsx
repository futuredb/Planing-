import type { DragEvent } from 'react'
import { AssignedFace } from '../AssignedFace'
import { memberDropBind } from '../Avatar'
import { CardStickers } from '../StickerBar'
import { stickerDropBind } from '../stickers'
import { useStore } from '../store'
import type { Item, Lane } from '../types'

const columns: { lane: Lane; title: string }[] = [
  { lane: 'todo', title: 'Спринт' },
  { lane: 'doing', title: 'В работе' },
  { lane: 'done', title: 'Готово' },
]

export function Sprint({ onOpen }: { onOpen: (id: string) => void }) {
  const { state, weekId, setGoal, toggleGoalClosed, moveItem, carryOver, closeSprint } =
    useStore()
  const sprint = state.sprints.find((s) => s.id === weekId)
  const inSprint = state.items.filter((it) => it.sprintId === weekId)
  const openCount = inSprint.filter((it) => it.lane !== 'done').length

  function onDrop(lane: Lane, e: DragEvent) {
    if (e.dataTransfer.getData('text/plain').startsWith('sticker:')) return
    const id = e.dataTransfer.getData('text/id')
    if (id) moveItem(id, lane, weekId)
  }

  return (
    <section className="page">
      <div className="goal">
        <textarea
          value={sprint?.goal ?? ''}
          onChange={(e) => setGoal(e.target.value)}
          rows={2}
          placeholder="Цель недели — закрыть"
        />
        <div className="goal-actions">
          <button
            type="button"
            className={sprint?.goalClosed ? 'primary' : ''}
            onClick={toggleGoalClosed}
          >
            {sprint?.goalClosed ? 'Цель закрыта' : 'Закрыть цель'}
          </button>
          <button type="button" onClick={closeSprint} disabled={!openCount}>
            Закрыть спринт
          </button>
        </div>
      </div>

      <div className="board">
        {columns.map((col) => (
          <div
            key={col.lane}
            className="col"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(col.lane, e)}
          >
            <h3>
              {col.title}
              <span>{inSprint.filter((it) => it.lane === col.lane).length}</span>
            </h3>
            {inSprint
              .filter((it) => it.lane === col.lane)
              .map((it) => (
                <Card
                  key={it.id}
                  item={it}
                  lane={col.lane}
                  onOpen={onOpen}
                  onCarry={() => carryOver(it.id)}
                  showCarry={col.lane !== 'done'}
                />
              ))}
          </div>
        ))}
      </div>
    </section>
  )
}

function Card({
  item,
  lane,
  onOpen,
  onCarry,
  showCarry,
}: {
  item: Item
  lane: Lane
  onOpen: (id: string) => void
  onCarry: () => void
  showCarry: boolean
}) {
  const { state, assignItem, moveItem, weekId, stickSticker } = useStore()
  const owner = state.members.find((m) => m.id === item.assigneeId)
  const memberDrop = memberDropBind((memberId, from) =>
    assignItem(item.id, memberId, from),
  )
  const stickerDrop = stickerDropBind((sticker, place, from) =>
    stickSticker(item.id, sticker, place, from),
  )

  return (
    <article
      className="card"
      draggable
      onDragStart={(e) => {
        if ((e.target as HTMLElement).closest('.stuck, .face, .card-head')) {
          e.preventDefault()
          return
        }
        e.dataTransfer.setData('text/id', item.id)
      }}
      onDragOver={(e) => {
        stickerDrop.onDragOver(e)
        memberDrop.onDragOver(e)
      }}
      onDrop={(e) => {
        stickerDrop.onDrop(e)
        if (e.defaultPrevented) return
        memberDrop.onDrop(e)
        const id = e.dataTransfer.getData('text/id')
        if (id) moveItem(id, lane, weekId)
      }}
    >
      <CardStickers item={item} />
      <button className="card-main" onClick={() => onOpen(item.id)}>
        <strong>{item.title}</strong>
      </button>
      <div className="card-head">
        {owner ? <AssignedFace itemId={item.id} member={owner} /> : <span className="face empty card" />}
      </div>
      {showCarry ? (
        <button type="button" className="ghost" onClick={onCarry}>
          В следующую неделю
        </button>
      ) : null}
    </article>
  )
}
