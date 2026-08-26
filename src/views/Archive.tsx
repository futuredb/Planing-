import { useStore } from '../store'
import type { Item } from '../types'

export function Archive({ onOpen }: { onOpen: (id: string) => void }) {
  const { state, moveItem } = useStore()
  const rows = state.items
    .filter((it) => it.lane === 'archive')
    .slice()
    .sort((a, b) => (b.archivedAt ?? b.createdAt) - (a.archivedAt ?? a.createdAt))

  return (
    <section className="page">
      <div className="page-head">
        <h2>Архив</h2>
        <p>Закрытые задачи. Можно вернуть в бэклог — запись не удаляется.</p>
      </div>
      {rows.length ? (
        <ul className="idea-list">
          {rows.map((it) => (
            <ArchiveRow key={it.id} item={it} onOpen={onOpen} onRestore={() => moveItem(it.id, 'backlog', null)} />
          ))}
        </ul>
      ) : (
        <p className="hint">Пока пусто.</p>
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
  const when = item.archivedAt ?? item.createdAt
  return (
    <li className="idea-card">
      <div className="idea-row">
        <button className="idea" onClick={() => onOpen(item.id)}>
          <strong>{item.title}</strong>
          <span>
            {new Date(when).toLocaleString('ru-RU', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </span>
        </button>
      </div>
      <div className="row tight">
        <button type="button" className="ghost" onClick={onRestore}>
          В бэклог
        </button>
      </div>
    </li>
  )
}
