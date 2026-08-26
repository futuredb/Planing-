import { useEffect, useRef, useState } from 'react'
import { AssignedFace } from '../AssignedFace'
import { memberDropBind } from '../Avatar'
import { CardStickers } from '../StickerBar'
import { stickerDropBind } from '../stickers'
import { useStore } from '../store'
import type { Criterion } from '../types'

function parseScore(raw: string, criterion: Criterion): number | null {
  const text = raw.trim().replace(',', '.')
  if (!text) return null
  const n = Number(text)
  if (!Number.isFinite(n)) return null
  const max = criterion.max || 5
  const step = criterion.step || 0.5
  const clamped = Math.min(max, Math.max(0, n))
  return Math.round(clamped / step) * step
}

function ScoreCell({
  value,
  criterion,
  onCommit,
}: {
  value: number | undefined
  criterion: Criterion
  onCommit: (next: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  function start() {
    setDraft(value == null ? '' : String(value))
    setEditing(true)
  }

  function commit() {
    const next = parseScore(draft, criterion)
    const prev = value ?? null
    setEditing(false)
    if (next !== prev) onCommit(next)
  }

  if (!editing) {
    return (
      <button type="button" className="score-hit" onClick={start}>
        {value ?? '—'}
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      className="score-input"
      inputMode="decimal"
      value={draft}
      aria-label={criterion.name}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setEditing(false)
        }
      }}
    />
  )
}

export function Backlog({ onOpen }: { onOpen: (id: string) => void }) {
  const {
    state,
    pullToSprint,
    addCriterion,
    updateCriterion,
    removeCriterion,
    scoreOf,
    assignItem,
    stickSticker,
    setScore,
  } = useStore()
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
                    <div>
                      <button className="link" onClick={() => onOpen(it.id)}>
                        {it.title}
                      </button>
                    </div>
                    {owner ? <AssignedFace itemId={it.id} member={owner} /> : <span className="face empty card" />}
                  </div>
                </td>
                {state.criteria.map((c) => (
                  <td key={c.id} className="num">
                    <ScoreCell
                      value={it.scores[c.id]}
                      criterion={c}
                      onCommit={(next) => setScore(it.id, c.id, next)}
                    />
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
