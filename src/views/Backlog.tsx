import { useEffect, useRef, useState, type DragEvent } from 'react'
import { AgentBadge } from '../AgentBadge'
import { AssignedFace } from '../AssignedFace'
import { cardDropBind } from '../card-drop'
import { ReactionBar } from '../StickerBar'
import { useStore } from '../store-context'
import type { Criterion, Item } from '../types'
import { Icon } from '../ui/Icon'


type BacklogTab = 'list' | 'matrix'
type MatrixBucket = 'urgent-important' | 'not-urgent-important' | 'urgent-not-important' | 'not-urgent-not-important'

const MATRIX_BUCKETS: { id: MatrixBucket; title: string }[] = [
  { id: 'urgent-important', title: 'Срочно важно' },
  { id: 'not-urgent-important', title: 'Не срочно важно' },
  { id: 'urgent-not-important', title: 'Срочно не важно' },
  { id: 'not-urgent-not-important', title: 'Не срочно не важно' },
]

const MATRIX_ITEM_MIME = 'application/x-funban-matrix-item'

function criterionByName(criteria: Criterion[], name: string) {
  return criteria.find((criterion) => criterion.name.trim().toLowerCase() === name.toLowerCase()) ?? null
}

function scoreValue(item: Item, criterion: Criterion | null) {
  if (!criterion) return 0
  return item.scores[criterion.id] ?? 0
}

function hasMatrixScores(item: Item, focus: Criterion | null, agenda: Criterion | null) {
  if (!focus || !agenda) return false
  return item.scores[focus.id] != null && item.scores[agenda.id] != null
}

function matrixBucket(item: Item, focus: Criterion | null, agenda: Criterion | null): MatrixBucket {
  const focusScore = scoreValue(item, focus)
  const agendaScore = scoreValue(item, agenda)
  const important = focusScore >= ((focus?.max ?? 3) / 2)
  const urgent = agendaScore >= ((agenda?.max ?? 3) / 2)

  if (urgent && important) return 'urgent-important'
  if (!urgent && important) return 'not-urgent-important'
  if (urgent && !important) return 'urgent-not-important'
  return 'not-urgent-not-important'
}

function bucketScores(bucket: MatrixBucket, focus: Criterion | null, agenda: Criterion | null) {
  const important = bucket === 'urgent-important' || bucket === 'not-urgent-important'
  const urgent = bucket === 'urgent-important' || bucket === 'urgent-not-important'

  return {
    focus: important ? (focus?.max ?? 3) : 0,
    agenda: urgent ? (agenda?.max ?? 3) : 0,
  }
}

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
  onChange,
}: {
  value: number | null | undefined
  criterion: Criterion
  onChange: (next: number | null) => void
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
    setEditing(false)
    onChange(next)
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
    toggleReaction,
  } = useStore()
  const [settings, setSettings] = useState(false)
  const [tab, setTab] = useState<BacklogTab>('list')
  const [draftScores, setDraftScores] = useState<Record<string, number | null>>({})
  const rows = state.items
    .filter((item) => item.lane === 'backlog' && !item.parentId)
    .slice()
    .sort((a, b) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1))
  const focusCriterion = criterionByName(state.criteria, 'Фокус')
  const agendaCriterion = criterionByName(state.criteria, 'Повестка')
  const matrixRows = rows.filter((item) => hasMatrixScores(item, focusCriterion, agendaCriterion))
  const unassignedMatrixRows = rows.filter((item) => !hasMatrixScores(item, focusCriterion, agendaCriterion))
  const matrix = MATRIX_BUCKETS.map((bucket) => ({
    ...bucket,
    items: matrixRows.filter((item) => matrixBucket(item, focusCriterion, agendaCriterion) === bucket.id),
  }))

  function draftKey(itemId: string, criterionId: string) {
    return `${itemId}:${criterionId}`
  }

  function scoreDraft(item: Item, criterion: Criterion) {
    const key = draftKey(item.id, criterion.id)
    return Object.prototype.hasOwnProperty.call(draftScores, key) ? draftScores[key] : item.scores[criterion.id]
  }

  function setScoreDraft(item: Item, criterion: Criterion, next: number | null) {
    const key = draftKey(item.id, criterion.id)
    const saved = item.scores[criterion.id] ?? null
    setDraftScores((current) => {
      const copy = { ...current }
      if (next === saved) {
        delete copy[key]
      } else {
        copy[key] = next
      }
      return copy
    })
  }

  function hasScoreDraft(item: Item) {
    return state.criteria.some((criterion) => Object.prototype.hasOwnProperty.call(draftScores, draftKey(item.id, criterion.id)))
  }

  function saveScoreDrafts(item: Item) {
    const changedCriteria = state.criteria.filter((criterion) => Object.prototype.hasOwnProperty.call(draftScores, draftKey(item.id, criterion.id)))
    changedCriteria.forEach((criterion) => setScore(item.id, criterion.id, draftScores[draftKey(item.id, criterion.id)]))
    if (!changedCriteria.length) return
    setDraftScores((current) => {
      const copy = { ...current }
      changedCriteria.forEach((criterion) => delete copy[draftKey(item.id, criterion.id)])
      return copy
    })
  }

  function startMatrixDrag(item: Item, event: DragEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('button, input, textarea, select')) {
      event.preventDefault()
      return
    }
    event.dataTransfer.setData(MATRIX_ITEM_MIME, item.id)
    event.dataTransfer.setData('text/plain', `matrix-item:${item.id}`)
    event.dataTransfer.effectAllowed = 'move'
  }

  function onMatrixDrop(bucket: MatrixBucket, event: DragEvent<HTMLElement>) {
    const itemId = event.dataTransfer.getData(MATRIX_ITEM_MIME)
    if (!itemId || !focusCriterion || !agendaCriterion) return
    const next = bucketScores(bucket, focusCriterion, agendaCriterion)
    event.preventDefault()
    setScore(itemId, focusCriterion.id, next.focus)
    setScore(itemId, agendaCriterion.id, next.agenda)
  }

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

      <div className="backlog-view-tabs" aria-label="Виды бэклога">
        <button type="button" className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>
          Список
        </button>
        <button type="button" className={tab === 'matrix' ? 'active' : ''} onClick={() => setTab('matrix')}>
          Матрица
        </button>
      </div>

      {rows.length ? (
        <>
          {tab === 'list' ? (
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
                  const cardDrop = cardDropBind(
                    (id, from) => assignItem(item.id, id, from),
                    (sticker) => {
                      const mine = item.stickers.some(
                        (placed) => placed.sticker === sticker && placed.by === state.currentMemberId,
                      )
                      if (!mine) toggleReaction(item.id, sticker)
                    },
                  )
                  return (
                    <tr
                      key={item.id}
                      className="item-drop-zone"
                      onDragEnter={cardDrop.onDragEnter}
                      onDragOver={cardDrop.onDragOver}
                      onDragLeave={cardDrop.onDragLeave}
                      onDrop={cardDrop.onDrop}
                    >
                      <td>
                        <div className="backlog-task">
                          <div className="task-title-line">
                            <button type="button" className="backlog-title" onClick={() => onOpen(item.id)}>
                              {item.title}
                            </button>
                            <AgentBadge item={item} compact />
                          </div>
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
                        <td
                          key={criterion.id}
                          className={`score-cell ${Object.prototype.hasOwnProperty.call(draftScores, draftKey(item.id, criterion.id)) ? 'score-cell-draft' : ''}`}
                        >
                          <ScoreCell
                            value={scoreDraft(item, criterion)}
                            criterion={criterion}
                            onChange={(next) => setScoreDraft(item, criterion, next)}
                          />
                        </td>
                      ))}
                      <td className="total-score">{scoreOf(item) ?? '—'}</td>
                      <td className="row-action">
                        {hasScoreDraft(item) ? (
                          <button type="button" className="icon-button score-save-button" onClick={() => saveScoreDrafts(item)} aria-label="Сохранить оценки">
                            <Icon name="check" />
                          </button>
                        ) : null}
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
          ) : null}

          {tab === 'list' ? (
          <ul className="backlog-mobile">
            {rows.map((item) => {
              const owner = state.members.find((member) => member.id === item.assigneeId)
              const cardDrop = cardDropBind(
                (id, from) => assignItem(item.id, id, from),
                (sticker) => {
                  const mine = item.stickers.some(
                    (placed) => placed.sticker === sticker && placed.by === state.currentMemberId,
                  )
                  if (!mine) toggleReaction(item.id, sticker)
                },
              )
              return (
                <li
                  key={item.id}
                  className="item-drop-zone"
                  onDragEnter={cardDrop.onDragEnter}
                  onDragOver={cardDrop.onDragOver}
                  onDragLeave={cardDrop.onDragLeave}
                  onDrop={cardDrop.onDrop}
                >
                  <div className="mobile-task-head">
                    <div className="task-title-line">
                      <button type="button" className="backlog-title" onClick={() => onOpen(item.id)}>
                        {item.title}
                      </button>
                      <AgentBadge item={item} compact />
                    </div>
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
          ) : null}

          {tab === 'matrix' ? (
            <>
              <div className="backlog-matrix">
                {matrix.map((bucket) => (
                  <section
                    key={bucket.id}
                    className={`matrix-quadrant ${bucket.id}`}
                    onDragOver={(event) => {
                      if (!Array.from(event.dataTransfer.types).includes(MATRIX_ITEM_MIME)) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={(event) => onMatrixDrop(bucket.id, event)}
                  >
                    <header className="matrix-head">
                      <h2>{bucket.title}</h2>
                      <span>{bucket.items.length}</span>
                    </header>
                    <div className="matrix-items">
                      {bucket.items.length ? bucket.items.map((item) => {
                        const owner = state.members.find((member) => member.id === item.assigneeId)
                        return (
                          <article
                            key={item.id}
                            className="matrix-card"
                            draggable
                            onDragStart={(event) => startMatrixDrag(item, event)}
                          >
                            <div className="task-title-line">
                              <button type="button" className="backlog-title" onClick={() => onOpen(item.id)}>
                                {item.title}
                              </button>
                              <AgentBadge item={item} compact />
                            </div>
                            <div className="backlog-meta matrix-card-footer">
                              {owner ? (
                                <span className="owner-chip">
                                  <AssignedFace itemId={item.id} member={owner} />
                                  <span>{owner.name}</span>
                                </span>
                              ) : (
                                <span className="unassigned">Без исполнителя</span>
                              )}
                              <ReactionBar item={item} compact />
                              <strong className="matrix-score">{scoreOf(item) ?? '—'}</strong>
                            </div>
                          </article>
                        )
                      }) : (
                        <p className="matrix-empty">Нет задач</p>
                      )}
                    </div>
                  </section>
                ))}
              </div>
              {unassignedMatrixRows.length ? (
                <section className="matrix-unassigned">
                  <header className="matrix-unassigned-head">
                    <h2>Нераспределённые</h2>
                    <span>{unassignedMatrixRows.length}</span>
                  </header>
                  <div className="matrix-items">
                    {unassignedMatrixRows.map((item) => {
                      const owner = state.members.find((member) => member.id === item.assigneeId)
                      return (
                        <article
                          key={item.id}
                          className="matrix-card"
                          draggable
                          onDragStart={(event) => startMatrixDrag(item, event)}
                        >
                          <div className="task-title-line">
                            <button type="button" className="backlog-title" onClick={() => onOpen(item.id)}>
                              {item.title}
                            </button>
                            <AgentBadge item={item} compact />
                          </div>
                          <div className="backlog-meta matrix-card-footer">
                            {owner ? (
                              <span className="owner-chip">
                                <AssignedFace itemId={item.id} member={owner} />
                                <span>{owner.name}</span>
                              </span>
                            ) : (
                              <span className="unassigned">Без исполнителя</span>
                            )}
                            <ReactionBar item={item} compact />
                            <strong className="matrix-score">{scoreOf(item) ?? '—'}</strong>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
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
