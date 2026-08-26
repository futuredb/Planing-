import { useState } from 'react'
import { AssignedFace } from '../AssignedFace'
import { memberDropBind } from '../Avatar'
import { CardStickers } from '../StickerBar'
import { stickerDropBind } from '../stickers'
import { useStore } from '../store'

export function Backlog({ onOpen }: { onOpen: (id: string) => void }) {
  const { state, pullToSprint, addCriterion, updateCriterion, removeCriterion, scoreOf, assignItem, stickSticker } =
    useStore()
  const [settings, setSettings] = useState(false)
  const rows = state.items
    .filter((it) => it.lane === 'backlog' && !it.parentId)
    .slice()
    .sort((a, b) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1))

  return (
    <section className={settings ? 'page split' : 'page'}>
      <div>
        <div className="page-head">
          <div className="page-head-row">
            <h2>Бэклог</h2>
            <button type="button" className="ghost" onClick={() => setSettings((open) => !open)}>
              {settings ? 'Скрыть настройки' : 'Настройки'}
            </button>
          </div>
          <p>
            Охват, выхлоп, фокус, повестка, вера — среднее. Напряг режет итог сверху, на веру не
            влияет.
          </p>
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
                    <button className="link" onClick={() => onOpen(it.id)}>
                      {it.title}
                    </button>
                    {owner ? <AssignedFace itemId={it.id} member={owner} /> : <span className="face empty card" />}
                  </div>
                </td>
                {state.criteria.map((c) => (
                  <td key={c.id} className="num">
                    {it.scores[c.id] ?? '—'}
                  </td>
                ))}
                <td className="num score">{scoreOf(it) ?? '—'}</td>
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

      {settings ? (
      <aside className="criteria">
        <h3>Критерии оценки</h3>
        {state.criteria.map((c) => (
          <div key={c.id} className="crit">
            <input
              value={c.name}
              onChange={(e) => updateCriterion(c.id, { name: e.target.value })}
            />
            <label>
              Макс.
              <input
                type="number"
                min={0.5}
                max={100}
                step={0.5}
                value={c.max}
                onChange={(e) => {
                  const max = Number(e.target.value)
                  if (!Number.isFinite(max) || max <= 0) return
                  updateCriterion(c.id, { max, step: max <= 3 ? 0.5 : 1 })
                }}
              />
            </label>
            <button type="button" className="ghost" onClick={() => removeCriterion(c.id)}>
              Убрать
            </button>
          </div>
        ))}
        <button type="button" onClick={addCriterion}>
          Добавить критерий
        </button>
      </aside>
      ) : null}
    </section>
  )
}
