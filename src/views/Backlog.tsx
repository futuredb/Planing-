import { AssignedFace } from '../AssignedFace'
import { memberDropBind } from '../Avatar'
import { CardStickers } from '../StickerBar'
import { stickerDropBind } from '../stickers'
import { useStore } from '../store'

export function Backlog({ onOpen }: { onOpen: (id: string) => void }) {
  const { state, pullToSprint, addCriterion, updateCriterion, removeCriterion, scoreOf, assignItem, stickSticker } =
    useStore()
  const rows = state.items
    .filter((it) => it.lane === 'backlog' && !it.parentId)
    .slice()
    .sort((a, b) => scoreOf(b) - scoreOf(a))

  return (
    <section className="page split">
      <div>
        <div className="page-head">
          <h2>Бэклог</h2>
          <p>Сортировка по вашим критериям. Оценка 1–5, вес можно менять.</p>
        </div>
        <table className="grid">
          <thead>
            <tr>
              <th>Задача</th>
              {state.criteria.map((c) => (
                <th key={c.id}>{c.name}</th>
              ))}
              <th>Балл</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it) => {
              const owner = state.members.find((m) => m.id === it.assigneeId)
              const memberDrop = memberDropBind((id, from) => assignItem(it.id, id, from))
              const stickerDrop = stickerDropBind((sticker, place, from) =>
                stickSticker(it.id, sticker, place, from),
              )
              return (
              <tr
                key={it.id}
                onDragOver={(e) => {
                  stickerDrop.onDragOver(e)
                  memberDrop.onDragOver(e)
                }}
                onDrop={(e) => {
                  stickerDrop.onDrop(e)
                  if (e.defaultPrevented) return
                  memberDrop.onDrop(e)
                }}
              >
                <td>
                  <div className="task-cell cardish">
                    <CardStickers item={it} />
                    {owner ? <AssignedFace itemId={it.id} member={owner} /> : <span className="face empty sm" />}
                    <button className="link" onClick={() => onOpen(it.id)}>
                      {it.title}
                    </button>
                  </div>
                </td>
                {state.criteria.map((c) => (
                  <td key={c.id} className="num">
                    {it.scores[c.id] ?? '—'}
                  </td>
                ))}
                <td className="num score">{scoreOf(it) || '—'}</td>
                <td>
                  <button type="button" onClick={() => pullToSprint(it.id)}>
                    В спринт
                  </button>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <aside className="criteria">
        <h3>Критерии оценки</h3>
        <p>Это не сторипоинты. Ставите свои оси и веса.</p>
        {state.criteria.map((c) => (
          <div key={c.id} className="crit">
            <input
              value={c.name}
              onChange={(e) => updateCriterion(c.id, { name: e.target.value })}
            />
            <label>
              Вес
              <input
                type="number"
                min={0}
                max={10}
                value={c.weight}
                onChange={(e) => updateCriterion(c.id, { weight: Number(e.target.value) })}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={c.invert}
                onChange={(e) => updateCriterion(c.id, { invert: e.target.checked })}
              />
              чем больше — тем хуже
            </label>
            <input
              className="hint-input"
              value={c.hint}
              placeholder="Зачем этот критерий"
              onChange={(e) => updateCriterion(c.id, { hint: e.target.value })}
            />
            <button type="button" className="ghost" onClick={() => removeCriterion(c.id)}>
              Убрать
            </button>
          </div>
        ))}
        <button type="button" onClick={addCriterion}>
          Добавить критерий
        </button>
      </aside>
    </section>
  )
}
