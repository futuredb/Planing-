import { AssignedFace } from '../AssignedFace'
import { ReactionBar } from '../StickerBar'
import { useStore } from '../store-context'
import type { Item } from '../types'
import { Icon } from '../ui/Icon'

export function Archive({ onOpen }: { onOpen: (id: string) => void }) {
  const { state, moveItem } = useStore()
  const rows = state.items
    .filter((item) => item.lane === 'archive')
    .slice()
    .sort((a, b) => (b.archivedAt ?? b.createdAt) - (a.archivedAt ?? a.createdAt))

  return (
    <section className="page">
      <div className="page-head">
        <span className="eyebrow">История</span>
        <h1>Архив</h1>
        <p>Закрытые задачи остаются доступными и в любой момент возвращаются в бэклог.</p>
      </div>
      {rows.length ? (
        <ul className="archive-list">
          {rows.map((item) => (
            <ArchiveRow
              key={item.id}
              item={item}
              onOpen={onOpen}
              onRestore={() => moveItem(item.id, 'backlog', null)}
            />
          ))}
        </ul>
      ) : (
        <div className="empty-state">
          <span><Icon name="archive" /></span>
          <h2>Архив пока пуст</h2>
          <p>Готовые задачи появятся здесь после закрытия спринта.</p>
        </div>
      )}
    </section>
  )
}

function ArchiveRow({
  item,
  onOpen,
  onRestore,
}: {
  item: Item
  onOpen: (id: string) => void
  onRestore: () => void
}) {
  const { state } = useStore()
  const owner = state.members.find((member) => member.id === item.assigneeId)
  const when = item.archivedAt ?? item.createdAt

  return (
    <li>
      <div className="archive-copy">
        <button type="button" onClick={() => onOpen(item.id)}>{item.title}</button>
        <div>
          <time>{new Date(when).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</time>
          {owner ? (
            <span className="owner-chip">
              <AssignedFace itemId={item.id} member={owner} />
              <span>{owner.name}</span>
            </span>
          ) : null}
          <ReactionBar item={item} compact />
        </div>
      </div>
      <button type="button" className="secondary-button compact-button" onClick={onRestore}>
        Вернуть в бэклог
      </button>
    </li>
  )
}
