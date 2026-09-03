import { useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { AgentBadge } from '../AgentBadge'
import { AssignedFace } from '../AssignedFace'
import { cardDropBind } from '../card-drop'
import { memberAvatar } from '../member'
import { ReactionBar } from '../StickerBar'
import { useStore } from '../store-context'
import type { Item, Lane } from '../types'
import { Icon } from '../ui/Icon'

const columns: { lane: Lane; title: string; empty: string }[] = [
  { lane: 'todo', title: 'Спринт', empty: 'Задачи на эту неделю появятся здесь.' },
  { lane: 'doing', title: 'В работе', empty: 'Перетащите сюда то, что уже начали.' },
  { lane: 'done', title: 'Готово', empty: 'Завершённые задачи ждут здесь.' },
]

const unassignedFilter = 'unassigned'

export function Sprint({ onOpen }: { onOpen: (id: string) => void }) {
  const { state, weekId, setGoal, toggleGoalClosed, moveItem, closeSprint } = useStore()
  const [actionsOpen, setActionsOpen] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [assigneeFilters, setAssigneeFilters] = useState<Set<string>>(() => new Set())
  const boardRef = useRef<HTMLDivElement>(null)
  const goalRef = useRef<HTMLTextAreaElement>(null)
  const sprint = state.sprints.find((candidate) => candidate.id === weekId)
  const inSprint = state.items.filter((item) => item.sprintId === weekId && item.lane !== 'archive')
  const filtersActive = assigneeFilters.size > 0
  const visibleInSprint = filtersActive
    ? inSprint.filter((item) => assigneeFilters.has(item.assigneeId ?? unassignedFilter))
    : inSprint

  useLayoutEffect(() => {
    const goal = goalRef.current
    if (!goal) return

    goal.style.height = 'auto'
    goal.style.height = `${goal.scrollHeight}px`
  }, [sprint?.goal, weekId])

  function onDrop(lane: Lane, event: DragEvent) {
    const id = event.dataTransfer.getData('text/id')
    if (id) moveItem(id, lane, weekId)
  }

  function scrollLane(lane: Lane) {
    boardRef.current?.querySelector<HTMLElement>(`[data-lane="${lane}"]`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'start',
    })
  }

  function toggleAssigneeFilter(id: string) {
    setAssigneeFilters((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="page sprint-page">
      <div className="sprint-summary">
        <div className="goal-field">
          <span className="eyebrow">Цель недели</span>
          <textarea
            ref={goalRef}
            value={sprint?.goal ?? ''}
            onChange={(event) => setGoal(event.target.value)}
            rows={1}
            aria-label="Цель недели"
            placeholder="Один понятный результат, ради которого идёт спринт"
          />
        </div>
        <div className="summary-actions">
          <button
            type="button"
            className={`goal-status${sprint?.goalClosed ? ' complete' : ''}`}
            onClick={toggleGoalClosed}
          >
            <Icon name="check" />
            {sprint?.goalClosed ? 'Цель закрыта' : 'Отметить результат'}
          </button>
          <div className="menu-wrap">
            <button
              type="button"
              className="icon-button"
              onClick={() => setActionsOpen((open) => !open)}
              aria-label="Действия со спринтом"
              aria-expanded={actionsOpen}
            >
              <Icon name="more" />
            </button>
            {actionsOpen ? (
              <div className="action-menu">
                <button
                  type="button"
                  className="danger-text"
                  onClick={() => {
                    setActionsOpen(false)
                    setConfirmClose(true)
                  }}
                >
                  Закрыть спринт…
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {sprint?.closed ? (
        <div className="inline-notice">
          <Icon name="check" />
          Этот спринт закрыт. Незавершённые задачи перенесены на следующую неделю.
        </div>
      ) : null}

      <div className="assignee-filters" role="group" aria-label="Фильтр по исполнителям">
        <span className="assignee-filter-label">Исполнители</span>
        <div className="assignee-filter-list">
          <button
            type="button"
            className={`assignee-filter all${filtersActive ? '' : ' active'}`}
            aria-label="Показать все задачи"
            aria-pressed={!filtersActive}
            onClick={() => setAssigneeFilters(new Set())}
          >
            Все
          </button>
          {state.members.map((member) => {
            const active = assigneeFilters.has(member.id)
            return (
              <button
                type="button"
                key={member.id}
                className={`assignee-filter${active ? ' active' : ''}`}
                aria-label={`Фильтр по исполнителю: ${member.name}`}
                aria-pressed={active}
                onClick={() => toggleAssigneeFilter(member.id)}
              >
                <img src={memberAvatar(member)} alt="" draggable={false} />
                <span>{member.name}</span>
              </button>
            )
          })}
          <button
            type="button"
            className={`assignee-filter${assigneeFilters.has(unassignedFilter) ? ' active' : ''}`}
            aria-label="Фильтр: без исполнителя"
            aria-pressed={assigneeFilters.has(unassignedFilter)}
            onClick={() => toggleAssigneeFilter(unassignedFilter)}
          >
            <span className="assignee-filter-empty">—</span>
            <span>Без исполнителя</span>
          </button>
        </div>
      </div>

      <div className="lane-tabs" aria-label="Колонки спринта">
        {columns.map((column) => (
          <button type="button" key={column.lane} onClick={() => scrollLane(column.lane)}>
            {column.title}
            <span>{visibleInSprint.filter((item) => item.lane === column.lane).length}</span>
          </button>
        ))}
      </div>

      <div className="board" ref={boardRef}>
        {columns.map((column) => {
          const items = visibleInSprint.filter((item) => item.lane === column.lane)
          return (
            <section
              key={column.lane}
              className="board-column"
              data-lane={column.lane}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onDrop(column.lane, event)}
            >
              <header className="column-head">
                <h2>{column.title}</h2>
                <span>{items.length}</span>
              </header>
              <div className="column-list">
                {items.map((item) => (
                  <SprintCard key={item.id} item={item} lane={column.lane} onOpen={onOpen} />
                ))}
                {!items.length ? (
                  <div className="column-empty">
                    {filtersActive ? 'У выбранных исполнителей здесь нет задач.' : column.empty}
                  </div>
                ) : null}
              </div>
            </section>
          )
        })}
      </div>

      {confirmClose ? (
        <div className="confirm-backdrop" onClick={() => setConfirmClose(false)}>
          <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="close-sprint-title" onClick={(event) => event.stopPropagation()}>
            <span className="confirm-icon"><Icon name="archive" /></span>
            <h2 id="close-sprint-title">Закрыть этот спринт?</h2>
            <p>Готовые задачи уйдут в архив, остальные — в спринт следующей недели.</p>
            <div className="dialog-actions">
              <button type="button" className="secondary-button" onClick={() => setConfirmClose(false)}>
                Отмена
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => {
                  closeSprint()
                  setConfirmClose(false)
                }}
              >
                Закрыть спринт
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function SprintCard({
  item,
  lane,
  onOpen,
}: {
  item: Item
  lane: Lane
  onOpen: (id: string) => void
}) {
  const { state, assignItem, moveItem, weekId, carryOver, toggleReaction } = useStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const owner = state.members.find((member) => member.id === item.assigneeId)
  const cardDrop = cardDropBind(
    (memberId, from) => assignItem(item.id, memberId, from),
    (sticker) => {
      const mine = item.stickers.some(
        (placed) => placed.sticker === sticker && placed.by === state.currentMemberId,
      )
      if (!mine) toggleReaction(item.id, sticker)
    },
  )

  return (
    <article
      className="task-card item-drop-zone"
      draggable
      onDragStart={(event) => {
        if ((event.target as HTMLElement).closest('button, input, textarea, select')) {
          event.preventDefault()
          return
        }
        event.dataTransfer.setData('text/id', item.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnter={cardDrop.onDragEnter}
      onDragOver={cardDrop.onDragOver}
      onDragLeave={cardDrop.onDragLeave}
      onDrop={cardDrop.onDrop}
    >
      <div className="task-card-top">
        <div className="task-title-line">
          <button type="button" className="task-title" onClick={() => onOpen(item.id)}>
            {item.title}
          </button>
          <AgentBadge item={item} compact />
        </div>
        <div className="menu-wrap">
          <button
            type="button"
            className="icon-button subtle"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Действия с задачей"
            aria-expanded={menuOpen}
          >
            <Icon name="more" />
          </button>
          {menuOpen ? (
            <div className="action-menu card-menu">
              {columns
                .filter((column) => column.lane !== lane)
                .map((column) => (
                  <button
                    type="button"
                    key={column.lane}
                    onClick={() => {
                      moveItem(item.id, column.lane, weekId)
                      setMenuOpen(false)
                    }}
                  >
                    В «{column.title}»
                  </button>
                ))}
              {lane !== 'done' ? (
                <button
                  type="button"
                  onClick={() => {
                    carryOver(item.id)
                    setMenuOpen(false)
                  }}
                >
                  На следующую неделю
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {item.body ? <p className="task-preview">{item.body}</p> : null}
      <div className="task-card-bottom">
        {owner ? (
          <div className="owner-chip">
            <AssignedFace itemId={item.id} member={owner} />
            <span>{owner.name}</span>
          </div>
        ) : (
          <span className="unassigned">Без исполнителя</span>
        )}
        <ReactionBar item={item} compact />
      </div>
    </article>
  )
}
