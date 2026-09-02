import { useEffect, useRef, useState } from 'react'
import { AssignedFace } from '../AssignedFace'
import { memberDropBind } from '../member'
import { ReactionBar } from '../StickerBar'
import { useStore } from '../store-context'
import type { Criterion } from '../types'
import { Icon } from '../ui/Icon'

function parseScore(raw: string, criterion: Criterion): number | null {
  const text = raw.trim().replace(',', '.')
  if (!text) return null
  const number = Number(text)
  if (!Number.isFinite(number)) return null
  const max = criterion.max || 5
  const step = criterion.step || 0.5
  return Math.round(Math.min(max, Math.max(0, number)) / step) * step
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
    const previous = value ?? null
    setEditing(false)
    if (next !== previous) onCommit(next)
  }

  if (!editing) {
    return (
      <button type="button" className="score-hit" onClick={start} aria-label={`${criterion.name}: ${value ?? 'не оценено'}`}>
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
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
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
    setScore,
  } = useStore()
  const [settings, setSettings] = useState(false)
  const rows = state.items
    .filter((item) => item.lane === 'backlog' && !item.parentId)
    .slice()
    .sort((a, b) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1))

  useEffect(() => {
    if (!settings) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettings(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settings])

  return (
    <section className="page">
      <div className="page-head page-head-actions">
        <div>
          <span className="eyebrow">Приоритеты</span>
          <h1>Бэклог</h1>
          <p>Задачи отсортированы по итоговой оценке. Нажмите на число, чтобы изменить его.</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => setSettings(true)}>
          <Icon name="settings" />
          Критерии
        </button>
      </div>

      {rows.length ? (
        <>
          <div className="backlog-table-wrap">
            <table className="backlog-table">
              <thead>
                <tr>
                  <th>Задача</th>
                  {state.criteria.map((criterion) => (
                    <th key={criterion.id} title={criterion.hint || undefined}>
                      {criterion.name}
                    </th>
                  ))}
                  <th>Балл</th>
                  <th><span className="sr-only">Действия</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const owner = state.members.find((member) => member.id === item.assigneeId)
                  const memberDrop = memberDropBind((id, from) => assignItem(item.id, id, from))
                  return (
                    <tr key={item.id} onDragOver={memberDrop.onDragOver} onDrop={memberDrop.onDrop}>
                      <td>
                        <div className="backlog-task">
                          <button type="button" className="backlog-title" onClick={() => onOpen(item.id)}>
                            {item.title}
                          </button>
                          <div className="backlog-meta">
                            {owner ? (
                              <span className="owner-chip">
                                <AssignedFace itemId={item.id} member={owner} />
                                <span>{owner.name}</span>
                              </span>
                            ) : (
                              <span className="unassigned">Без исполнителя</span>
                            )}
                            <ReactionBar item={item} compact />
                          </div>
                        </div>
                      </td>
                      {state.criteria.map((criterion) => (
                        <td key={criterion.id} className="score-cell">
                          <ScoreCell
                            value={item.scores[criterion.id]}
                            criterion={criterion}
                            onCommit={(next) => setScore(item.id, criterion.id, next)}
                          />
                        </td>
                      ))}
                      <td className="total-score">{scoreOf(item) ?? '—'}</td>
                      <td className="row-action">
                        <button type="button" className="secondary-button compact-button" onClick={() => pullToSprint(item.id)}>
                          В спринт
                          <Icon name="arrow" size={16} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <ul className="backlog-mobile">
            {rows.map((item) => {
              const owner = state.members.find((member) => member.id === item.assigneeId)
              return (
                <li key={item.id}>
                  <div className="mobile-task-head">
                    <button type="button" className="backlog-title" onClick={() => onOpen(item.id)}>
                      {item.title}
                    </button>
                    <span className="score-badge">{scoreOf(item) ?? '—'}</span>
                  </div>
                  <div className="mobile-task-foot">
                    {owner ? (
                      <span className="owner-chip">
                        <AssignedFace itemId={item.id} member={owner} />
                        <span>{owner.name}</span>
                      </span>
                    ) : (
                      <span className="unassigned">Без исполнителя</span>
                    )}
                    <ReactionBar item={item} compact />
                    <button type="button" className="icon-button" onClick={() => pullToSprint(item.id)} aria-label="Добавить в спринт">
                      <Icon name="arrow" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <div className="empty-state">
          <span><Icon name="backlog" /></span>
          <h2>Бэклог разобран</h2>
          <p>Новые идеи можно перенести сюда из входящих.</p>
        </div>
      )}

      {settings ? (
        <div className="panel-backdrop" onClick={() => setSettings(false)}>
          <aside className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="criteria-title" onClick={(event) => event.stopPropagation()}>
            <header className="panel-head">
              <div>
                <span className="eyebrow">Настройка модели</span>
                <h2 id="criteria-title">Критерии оценки</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setSettings(false)} aria-label="Закрыть">
                <Icon name="close" />
              </button>
            </header>
            <div className="criteria-list">
              {state.criteria.map((criterion) => (
                <div key={criterion.id} className="criterion-row">
                  <label>
                    <span>Название</span>
                    <input value={criterion.name} onChange={(event) => updateCriterion(criterion.id, { name: event.target.value })} />
                  </label>
                  <label className="criterion-max">
                    <span>Максимум</span>
                    <input
                      type="number"
                      min={0.5}
                      max={100}
                      step={0.5}
                      value={criterion.max}
                      onChange={(event) => {
                        const max = Number(event.target.value)
                        if (!Number.isFinite(max) || max <= 0) return
                        updateCriterion(criterion.id, { max, step: max <= 3 ? 0.5 : 1 })
                      }}
                    />
                  </label>
                  <button type="button" className="icon-button danger-icon" onClick={() => removeCriterion(criterion.id)} aria-label={`Удалить критерий ${criterion.name}`}>
                    <Icon name="trash" />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="secondary-button add-criterion" onClick={addCriterion}>
              <Icon name="plus" />
              Добавить критерий
            </button>
          </aside>
        </div>
      ) : null}
    </section>
  )
}
