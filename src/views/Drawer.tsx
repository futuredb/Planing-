import { useEffect, useState, type FormEvent } from 'react'
import { Avatar } from '../Avatar'
import { memberDropBind } from '../member'
import { ReactionBar } from '../StickerBar'
import { filesToAttachments } from '../storage'
import { useStore } from '../store-context'
import type { Attachment, Item, Lane } from '../types'
import { Icon } from '../ui/Icon'

type DrawerTab = 'details' | 'score' | 'links' | 'comments'

const tabs: { id: DrawerTab; label: string }[] = [
  { id: 'details', label: 'Детали' },
  { id: 'score', label: 'Оценка' },
  { id: 'links', label: 'Связи' },
  { id: 'comments', label: 'Комментарии' },
]

export function Drawer({
  item,
  onOpen,
  onClose,
}: {
  item: Item
  onOpen: (id: string) => void
  onClose: () => void
}) {
  const {
    state,
    weekId,
    updateItem,
    removeItem,
    pullToSprint,
    carryOver,
    moveItem,
    decompose,
    linkTasks,
    unlinkTask,
    setScore,
    addComment,
    scoreOf,
    assignItem,
  } = useStore()
  const [tab, setTab] = useState<DrawerTab>('details')
  const [parts, setParts] = useState('')
  const [comment, setComment] = useState('')
  const [preview, setPreview] = useState<Attachment | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const children = state.items.filter((candidate) => candidate.parentId === item.id)
  const peers = (item.relatedIds ?? [])
    .map((id) => state.items.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is Item => Boolean(candidate))
  const thread = state.comments.filter((entry) => entry.itemId === item.id)
  const parent = state.items.find((candidate) => candidate.id === item.parentId)
  const memberDrop = memberDropBind((id, from) => assignItem(item.id, id, from))

  useEffect(() => {
    document.body.classList.add('modal-open')
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (preview) setPreview(null)
      else if (confirmDelete) setConfirmDelete(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.classList.remove('modal-open')
      window.removeEventListener('keydown', onKey)
    }
  }, [confirmDelete, onClose, preview])

  function sendComment(event: FormEvent) {
    event.preventDefault()
    if (!comment.trim()) return
    addComment(item.id, comment)
    setComment('')
  }

  function split() {
    const titles = parts.split('\n')
    if (!titles.some((title) => title.trim())) return
    decompose(item.id, titles)
    setParts('')
  }

  function connect() {
    const titles = parts.split('\n')
    if (!titles.some((title) => title.trim())) return
    linkTasks(item.id, titles)
    setParts('')
  }

  async function addImages(list: FileList | File[]) {
    const next = await filesToAttachments(list)
    if (!next.length) return
    updateItem(item.id, { attachments: [...item.attachments, ...next] })
  }

  function setLane(next: Lane) {
    const sprintId = next === 'todo' || next === 'doing' || next === 'done' ? weekId : null
    moveItem(item.id, next, sprintId)
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}>
        <aside
          className="drawer"
          role="dialog"
          aria-modal="true"
          aria-label={`Задача: ${item.title}`}
          onClick={(event) => event.stopPropagation()}
          onDragOver={memberDrop.onDragOver}
          onDrop={async (event) => {
            memberDrop.onDrop(event)
            if (event.defaultPrevented) return
            if (event.dataTransfer.files.length) {
              event.preventDefault()
              await addImages(event.dataTransfer.files)
            }
          }}
        >
          <header className="drawer-head">
            <div className="drawer-heading">
              <span className={`lane-badge lane-${item.lane}`}>{laneName(item.lane)}</span>
              <span className="autosave">Сохраняется автоматически</span>
            </div>
            <div className="drawer-head-actions">
              <div className="menu-wrap">
                <button type="button" className="icon-button" onClick={() => setMenuOpen((open) => !open)} aria-label="Другие действия">
                  <Icon name="more" />
                </button>
                {menuOpen ? (
                  <div className="action-menu drawer-menu">
                    <button
                      type="button"
                      className="danger-text"
                      onClick={() => {
                        setMenuOpen(false)
                        setConfirmDelete(true)
                      }}
                    >
                      <Icon name="trash" size={16} />
                      Удалить задачу…
                    </button>
                  </div>
                ) : null}
              </div>
              <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть инспектор">
                <Icon name="close" />
              </button>
            </div>
          </header>

          <nav className="drawer-tabs" aria-label="Разделы задачи">
            {tabs.map((entry) => (
              <button
                type="button"
                key={entry.id}
                className={tab === entry.id ? 'active' : ''}
                onClick={() => setTab(entry.id)}
                aria-current={tab === entry.id ? 'page' : undefined}
              >
                {entry.label}
                {entry.id === 'comments' && thread.length ? <span>{thread.length}</span> : null}
                {entry.id === 'links' && peers.length + children.length ? <span>{peers.length + children.length}</span> : null}
              </button>
            ))}
          </nav>

          <div className="drawer-content">
            {tab === 'details' ? (
              <div className="drawer-section">
                {parent ? (
                  <button type="button" className="parent-link" onClick={() => onOpen(parent.id)}>
                    <Icon name="left" size={15} />
                    Часть задачи «{parent.title}»
                  </button>
                ) : null}
                <textarea
                  className="drawer-title"
                  value={item.title}
                  rows={2}
                  onChange={(event) => updateItem(item.id, { title: event.target.value })}
                  aria-label="Название задачи"
                />
                <textarea
                  className="drawer-description"
                  rows={6}
                  value={item.body}
                  onChange={(event) => updateItem(item.id, { body: event.target.value })}
                  placeholder="Добавьте описание, ссылку или контекст"
                  aria-label="Описание задачи"
                />

                <ReactionBar item={item} />

                <div className="detail-grid">
                  <div className="detail-field">
                    <span className="field-label">Исполнитель</span>
                    <div className="assignee-list">
                      <button
                        type="button"
                        className={`avatar-option empty-option${item.assigneeId === null ? ' current' : ''}`}
                        onClick={() => assignItem(item.id, null)}
                        aria-label="Без исполнителя"
                      >
                        —
                      </button>
                      {state.members.map((member) => (
                        <Avatar
                          key={member.id}
                          member={member}
                          current={item.assigneeId === member.id}
                          onPick={() => assignItem(item.id, member.id)}
                        />
                      ))}
                    </div>
                  </div>
                  <label className="detail-field">
                    <span className="field-label">Статус</span>
                    <select value={item.lane} onChange={(event) => setLane(event.target.value as Lane)}>
                      <option value="inbox">Входящие</option>
                      <option value="backlog">Бэклог</option>
                      <option value="todo">Спринт</option>
                      <option value="doing">В работе</option>
                      <option value="done">Готово</option>
                      <option value="archive">Архив</option>
                    </select>
                  </label>
                </div>

                <div className="drawer-actions">
                  {item.lane === 'archive' ? (
                    <button type="button" className="primary-button" onClick={() => moveItem(item.id, 'backlog', null)}>
                      Вернуть в бэклог
                    </button>
                  ) : (
                    <>
                      <button type="button" className="primary-button" onClick={() => pullToSprint(item.id)}>
                        В этот спринт
                      </button>
                      <button type="button" className="secondary-button" onClick={() => carryOver(item.id)}>
                        На следующую неделю
                      </button>
                    </>
                  )}
                </div>

                <div className="attachment-section">
                  <div className="section-head">
                    <h2>Вложения</h2>
                    <span>{item.attachments.length}</span>
                  </div>
                  {item.attachments.length ? (
                    <div className="thumbs">
                      {item.attachments.map((attachment) => (
                        <figure key={attachment.id} className="thumb-item">
                          <button type="button" className="thumb-open" onClick={() => setPreview(attachment)}>
                            <img src={attachment.dataUrl} alt={attachment.name} />
                          </button>
                          <button
                            type="button"
                            className="thumb-remove"
                            onClick={() => updateItem(item.id, { attachments: item.attachments.filter((entry) => entry.id !== attachment.id) })}
                            aria-label="Удалить картинку"
                          >
                            <Icon name="close" size={14} />
                          </button>
                        </figure>
                      ))}
                    </div>
                  ) : null}
                  <label className="secondary-button file-button">
                    <Icon name="image" />
                    Добавить изображение
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(event) => {
                        if (event.target.files) void addImages(event.target.files)
                        event.target.value = ''
                      }}
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {tab === 'score' ? (
              <div className="drawer-section">
                <div className="score-summary">
                  <span className="eyebrow">Итоговая оценка</span>
                  <strong>{scoreOf(item) ?? '—'}</strong>
                  <p>Позитивные критерии усредняются, а напряг снижает итоговый балл.</p>
                </div>
                <div className="score-list">
                  {state.criteria.map((criterion) => (
                    <div key={criterion.id} className="score-control">
                      <div>
                        <label htmlFor={`score-${criterion.id}`}>{criterion.name}</label>
                        <output>{item.scores[criterion.id] ?? 'Не оценено'}</output>
                      </div>
                      <input
                        id={`score-${criterion.id}`}
                        type="range"
                        min={0}
                        max={criterion.max}
                        step={criterion.step}
                        value={item.scores[criterion.id] ?? 0}
                        onChange={(event) => setScore(item.id, criterion.id, Number(event.target.value))}
                      />
                      {item.scores[criterion.id] != null ? (
                        <button type="button" className="text-button" onClick={() => setScore(item.id, criterion.id, null)}>
                          Сбросить
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {tab === 'links' ? (
              <div className="drawer-section">
                <div className="section-copy">
                  <h2>Связанные задачи</h2>
                  <p>Свяжите существующую задачу или создайте несколько частей из списка.</p>
                </div>
                <select
                  defaultValue=""
                  onChange={(event) => {
                    const title = event.target.value
                    if (!title) return
                    linkTasks(item.id, [title])
                    event.target.value = ''
                  }}
                >
                  <option value="">Выбрать существующую задачу…</option>
                  {state.items
                    .filter(
                      (candidate) =>
                        candidate.lane !== 'archive' &&
                        candidate.id !== item.id &&
                        !(item.relatedIds ?? []).includes(candidate.id) &&
                        candidate.parentId !== item.id,
                    )
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.title}>{candidate.title}</option>
                    ))}
                </select>
                <textarea
                  rows={4}
                  value={parts}
                  onChange={(event) => setParts(event.target.value)}
                  placeholder="Название задачи, по одной в строке"
                />
                <div className="drawer-actions">
                  <button type="button" className="secondary-button" onClick={connect}>Связать задачи</button>
                  <button type="button" className="primary-button" onClick={split}>Создать части</button>
                </div>

                {peers.length ? (
                  <div className="linked-list">
                    <h3>Связаны</h3>
                    {peers.map((peer) => (
                      <div key={peer.id} className="linked-row">
                        <button type="button" onClick={() => onOpen(peer.id)}>{peer.title}</button>
                        <button type="button" className="icon-button" onClick={() => unlinkTask(item.id, peer.id)} aria-label="Убрать связь">
                          <Icon name="close" size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {children.length ? (
                  <div className="linked-list">
                    <h3>Части задачи</h3>
                    {children.map((child) => (
                      <button type="button" key={child.id} className="linked-row child-row" onClick={() => onOpen(child.id)}>
                        <span>{child.title}</span>
                        <span className={`lane-badge lane-${child.lane}`}>{laneName(child.lane)}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {tab === 'comments' ? (
              <div className="drawer-section comments-section">
                <div className="section-copy">
                  <h2>Комментарии</h2>
                  <p>Короткий рабочий контекст для команды.</p>
                </div>
                {thread.length ? (
                  <ul className="comments">
                    {thread.map((entry) => {
                      const author = state.members.find((member) => member.id === entry.authorId)
                      return (
                        <li key={entry.id}>
                          <div>
                            <strong>{author?.name ?? '—'}</strong>
                            <time>
                              {new Date(entry.createdAt).toLocaleString('ru-RU', {
                                day: 'numeric',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </time>
                          </div>
                          <p>{entry.text}</p>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <div className="empty-state small">
                    <h2>Пока без комментариев</h2>
                    <p>Добавьте контекст для команды.</p>
                  </div>
                )}
                <form onSubmit={sendComment} className="comment-form">
                  <textarea
                    rows={3}
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="Написать комментарий…"
                  />
                  <button type="submit" className="primary-button">Отправить</button>
                </form>
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      {preview ? (
        <div className="image-preview" onClick={() => setPreview(null)}>
          <button type="button" className="icon-button" onClick={() => setPreview(null)} aria-label="Закрыть превью">
            <Icon name="close" />
          </button>
          <img src={preview.dataUrl} alt={preview.name} onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="confirm-backdrop" onClick={() => setConfirmDelete(false)}>
          <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-task-title" onClick={(event) => event.stopPropagation()}>
            <span className="confirm-icon danger"><Icon name="trash" /></span>
            <h2 id="delete-task-title">Удалить задачу?</h2>
            <p>Задача, её части и комментарии будут удалены без возможности восстановления.</p>
            <div className="dialog-actions">
              <button type="button" className="secondary-button" onClick={() => setConfirmDelete(false)}>Отмена</button>
              <button
                type="button"
                className="danger-button"
                onClick={() => {
                  removeItem(item.id)
                  onClose()
                }}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function laneName(lane: Lane) {
  return {
    inbox: 'Входящие',
    backlog: 'Бэклог',
    todo: 'Спринт',
    doing: 'В работе',
    done: 'Готово',
    archive: 'Архив',
  }[lane]
}
