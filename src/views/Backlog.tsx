import { backlogBucket } from '../../priority-score.mjs'
import { useBacklogReview } from '../useBacklogReview'
import { TrendwatchReview } from './TrendwatchReview'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { AgentBadge } from '../AgentBadge'
import { AssignedFace } from '../AssignedFace'
import { AuthorMeta } from '../AuthorMeta'
import { cardDropBind } from '../card-drop'
import { ReactionBar } from '../StickerBar'
import { useStore } from '../store-context'
import type { Criterion, Item, MatrixBucket } from '../types'
import { Icon } from '../ui/Icon'


type BacklogTab = 'list' | 'matrix'

const MATRIX_BUCKETS: { id: MatrixBucket; title: string }[] = [
  { id: 'take-next', title: 'Берём следующим' },
  { id: 'need-finish', title: 'Нужно закончить' },
  { id: 'research-next', title: 'Что исследовать дальше' },
  { id: 'automate', title: 'Что стоит автоматизировать' },
  { id: 'need-clarify', title: 'Нужно прояснить' },
]

const MATRIX_ITEM_MIME = 'application/x-funban-matrix-item'

function isMatrixBucket(value: Item['matrixBucket']): value is MatrixBucket {
  return MATRIX_BUCKETS.some((bucket) => bucket.id === value)
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
    syncStatus,
    pullToSprint,
    addCriterion,
    updateCriterion,
    removeCriterion,
    scoreOf,
    assignItem,
    setScore,
    toggleReaction,
    updateItem,
  } = useStore()
  const moreMenu=useRef<HTMLDetailsElement>(null)
  useEffect(()=>{
    const dismiss=(event:PointerEvent)=>{
      if(moreMenu.current?.open&&!moreMenu.current.contains(event.target as Node))moreMenu.current.open=false
    }
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&moreMenu.current?.open){moreMenu.current.open=false;moreMenu.current.querySelector('summary')?.focus()}
    }
    document.addEventListener('pointerdown',dismiss)
    document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape)}
  },[])
  const review=useBacklogReview(state.updatedAt)
  const [now,setNow]=useState(Date.now)
  useEffect(()=>{
    const refresh=()=>setNow(Date.now())
    const timer=window.setInterval(refresh,60000)
    document.addEventListener('visibilitychange',refresh)
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh)}
  },[])
  const [sort,setSort]=useState<'saved'|'ai'>('saved')
  const proposed=(id:string)=>{const j=review.data?.jobs.find(j=>j.itemId===id);return j?.status==='ready'&&!j.stale&&!j.reviewDue?j.score:null}
  const aiReview=(item:Item)=>{const j=review.data?.jobs.find(j=>j.itemId===item.id);return <TrendwatchReview item={item} onOpen={onOpen} preview refreshKey={j?`${j.id}:${j.status}:${j.stale}`:''}/>}
  const [matrixNotice,setMatrixNotice]=useState('')
  const needsReview=(item:Item)=>Boolean(review.data?.reviews?.find(r=>r.itemId===item.id)?.needsDecision)
  const reviewLabel=(item:Item)=>{
    const status=review.data?.reviews?.find(r=>r.itemId===item.id)
    if(!status)return null
    const returned=status.returnedAt!=null&&status.returnedAt>=status.dueAt
    const deadline=status.needsDecision?status.returnAt:status.dueAt
    const days=Math.max(0,Math.min(status.needsDecision?14:30,Math.ceil((deadline-now)/86400000)))
    const date=new Date(deadline).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})
    const description=returned?'Задача перенесена в «Не разобрано»: срок пересмотра и 14 дней ожидания истекли.':status.needsDecision
      ?`Нужен пересмотр. До переноса в «Не разобрано» без решения лида: ${days} дн. (${date}).`
      :`До пересмотра оценки: ${days} дн. (${date}).`
    return <span className={`priority-review-countdown${status.needsDecision?' priority-review-alert':''}`}
      title={description} aria-label={description} tabIndex={0}>{returned?0:days} дн.</span>
  }
  const [settings, setSettings] = useState(false)
  const [tab, setTab] = useState<BacklogTab>('matrix')
  const [draftScores, setDraftScores] = useState<Record<string, number | null>>({})
  const rows = state.items
    .filter((item) => item.lane === 'backlog' && !item.parentId)
    .slice()
    .sort((a,b)=>sort==='ai'?(proposed(b.id)??-1)-(proposed(a.id)??-1):(scoreOf(b)??-1)-(scoreOf(a)??-1))
  const matrixRows = rows.filter((item) => isMatrixBucket(backlogBucket(item,state.criteria) as Item['matrixBucket']))
  const unassignedMatrixRows = rows.filter((item) => !isMatrixBucket(backlogBucket(item,state.criteria) as Item['matrixBucket']))
  const matrix = MATRIX_BUCKETS.map((bucket) => ({
    ...bucket,
    items: matrixRows.filter((item) => backlogBucket(item,state.criteria) === bucket.id),
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

  function onMatrixDrop(bucket: MatrixBucket | null, event: DragEvent<HTMLElement>) {
    const itemId = event.dataTransfer.getData(MATRIX_ITEM_MIME)
    if (!itemId) return
    event.preventDefault()
    const item=state.items.find(i=>i.id===itemId)
    if(bucket&&item&&(scoreOf(item)??0)<=0){setMatrixNotice('Сначала задайте и подтвердите положительную оценку. Пока задача остаётся в «Не разобрано».');return}
    setMatrixNotice('')
    updateItem(itemId, { matrixBucket: bucket })
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
      {matrixNotice?<p className="research-notice" role="status">{matrixNotice}</p>:null}
      <div className="page-head page-head-actions">
        <div>
          <span className="eyebrow">Приоритеты</span>
          <h1>Бэклог</h1>
          <p>{sort==='ai'?'Порядок по предложению ИИ. Сохранённые оценки изменятся только после подтверждения.':'Задачи отсортированы по итоговой оценке. Нажмите на число, чтобы изменить его.'}</p>
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

      <div className="backlog-ai-toolbar">
        <label>Сортировка <select aria-label="Сортировка бэклога" value={sort} onChange={e=>setSort(e.target.value as 'saved'|'ai')}><option value="saved">По сохранённой оценке</option><option value="ai">По оценке ИИ</option></select></label>
        {review.data?.batch?.active?<button type="button" className="text-button" disabled={review.busy} onClick={()=>void review.run(true)}>Остановить</button>:null}
        {review.data?.batch?<span role="status">Обработано {review.data.batch.completed} из {review.data.batch.total}{review.data.batch.failed?` · Ошибок ${review.data.batch.failed}`:''}{review.data.batch.cancelled?` · Отменено ${review.data.batch.cancelled}`:''}</span>:null}
        <details ref={moreMenu} className="backlog-more">
          <summary role="button" className="secondary-button compact-button" aria-label="Действия бэклога" title="Действия бэклога">⋯</summary>
          <div className="backlog-more-popover">
            <button type="button" disabled={review.busy||!review.data?.available||review.data.busy||!rows.length||syncStatus!=='saved'} onClick={()=>{if(moreMenu.current)moreMenu.current.open=false;void review.run().then(ok=>{if(ok)setSort('ai')})}}>Переоценить бэклог</button>
          </div>
        </details>
      </div>
      {review.error?<p className="research-error" role="alert">{review.error}</p>:null}
      {sort==='ai'?<p className="backlog-ai-caption">{tab==='matrix'?'Сортировка внутри колонок. ':''}При равных баллах сохраняется порядок доски. Без актуальной оценки ИИ — в конце. Переносы между колонками остаются за вами.</p>:null}

      {rows.length ? (
        <>
          {tab === 'list' ? (
          <section className="backlog-list-panel">
            <header className="matrix-unassigned-head">
              <h2>Задачи</h2>
              <span>{rows.length}</span>
            </header>
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
                      className={`item-drop-zone${needsReview(item)?' priority-review-needed':''}`}
                      onDragEnter={cardDrop.onDragEnter}
                      onDragOver={cardDrop.onDragOver}
                      onDragLeave={cardDrop.onDragLeave}
                      onDrop={cardDrop.onDrop}
                    >
                      <td>
                        <div className="backlog-task">
                          <div className="task-title-line backlog-review-title">
                            <button type="button" className="backlog-title" onClick={() => onOpen(item.id)}>
                              {item.title}
                            </button>
                            <AgentBadge item={item} compact />
                            {reviewLabel(item)}
                            {sort==='ai'&&proposed(item.id)===null?<span className="backlog-ai-unrated">Без оценки ИИ</span>:null}
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
                            <AuthorMeta item={item} members={state.members} actors={state.actors} compact />
                            <ReactionBar item={item} compact />
                          </div>
                        </div>
                      </td>
                      {state.criteria.map((criterion) => (
                        <td
                          key={criterion.id}
                          className={`score-cell ${Object.prototype.hasOwnProperty.call(draftScores, draftKey(item.id, criterion.id)) ? 'score-cell-draft' : ''}`}
                        >
                          {item.priorityScore !== undefined ? <span title="Используется единая оценка приоритета">{item.scores[criterion.id] ?? '—'}</span> : <ScoreCell
                            value={scoreDraft(item, criterion)}
                            criterion={criterion}
                            onChange={(next) => setScoreDraft(item, criterion, next)}
                          />}
                        </td>
                      ))}
                      <td className="total-score"><span className="backlog-score-pair">{aiReview(item)}<span>{scoreOf(item) ?? '—'}</span></span>{item.priorityScore !== undefined ? <span className="sr-only">Единая оценка, изменяется в карточке задачи</span> : null}</td>
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
                  className={`item-drop-zone${needsReview(item)?' priority-review-needed':''}`}
                  onDragEnter={cardDrop.onDragEnter}
                  onDragOver={cardDrop.onDragOver}
                  onDragLeave={cardDrop.onDragLeave}
                  onDrop={cardDrop.onDrop}
                >
                  <div className="mobile-task-head">
                    <div className="task-title-line backlog-review-title">
                      <button type="button" className="backlog-title" onClick={() => onOpen(item.id)}>
                        {item.title}
                      </button>
                      <AgentBadge item={item} compact />
                            {reviewLabel(item)}
                            {sort==='ai'&&proposed(item.id)===null?<span className="backlog-ai-unrated">Без оценки ИИ</span>:null}
                    </div>
                    <span className="backlog-score-pair">{aiReview(item)}<span className="score-badge">{scoreOf(item) ?? '—'}</span></span>
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
                    <AuthorMeta item={item} members={state.members} actors={state.actors} compact />
                    <ReactionBar item={item} compact />
                    <button type="button" className="icon-button" onClick={() => pullToSprint(item.id)} aria-label="Добавить в спринт">
                      <Icon name="arrow" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          </section>
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
                            className={`matrix-card${needsReview(item)?' priority-review-needed':''}`}
                            draggable
                            onDragStart={(event) => startMatrixDrag(item, event)}
                          >
                            <div className="task-title-line backlog-review-title">
                              <button type="button" className="backlog-title" onClick={() => onOpen(item.id)}>
                                {item.title}
                              </button>
                              <AgentBadge item={item} compact />
                            {reviewLabel(item)}
                            {sort==='ai'&&proposed(item.id)===null?<span className="backlog-ai-unrated">Без оценки ИИ</span>:null}
                            </div>
                            <div className="backlog-meta matrix-card-meta">
                              {owner ? (
                                <span className="owner-chip">
                                  <AssignedFace itemId={item.id} member={owner} />
                                  <span>{owner.name}</span>
                                </span>
                              ) : (
                                <span className="unassigned">Без исполнителя</span>
                              )}
                              <AuthorMeta item={item} members={state.members} actors={state.actors} compact />
                            </div>
                            <div className="matrix-card-footer">
                              <ReactionBar item={item} compact />
                              <span className="backlog-score-pair">{aiReview(item)}<strong className="matrix-score">{scoreOf(item) ?? '—'}</strong></span>
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
                <section className="matrix-unassigned" onDragOver={event=>event.preventDefault()} onDrop={event=>onMatrixDrop(null,event)}>
                  <header className="matrix-unassigned-head">
                    <h2>Не разобрано</h2>
                    <span>{unassignedMatrixRows.length}</span>
                  </header>
                  <div className="matrix-items">
                    {unassignedMatrixRows.map((item) => {
                      const owner = state.members.find((member) => member.id === item.assigneeId)
                      return (
                        <article
                          key={item.id}
                          className={`matrix-card${needsReview(item)?' priority-review-needed':''}`}
                          draggable
                          onDragStart={(event) => startMatrixDrag(item, event)}
                        >
                          <div className="task-title-line backlog-review-title">
                            <button type="button" className="backlog-title" onClick={() => onOpen(item.id)}>
                              {item.title}
                            </button>
                            <AgentBadge item={item} compact />
                            {reviewLabel(item)}
                            {sort==='ai'&&proposed(item.id)===null?<span className="backlog-ai-unrated">Без оценки ИИ</span>:null}
                          </div>
                          <div className="backlog-meta matrix-card-meta">
                            {owner ? (
                              <span className="owner-chip">
                                <AssignedFace itemId={item.id} member={owner} />
                                <span>{owner.name}</span>
                              </span>
                            ) : (
                              <span className="unassigned">Без исполнителя</span>
                            )}
                            <AuthorMeta item={item} members={state.members} actors={state.actors} compact />
                          </div>
                          <div className="matrix-card-footer">
                            <ReactionBar item={item} compact />
                            <span className="backlog-score-pair">{aiReview(item)}<strong className="matrix-score">{scoreOf(item) ?? '—'}</strong></span>
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
