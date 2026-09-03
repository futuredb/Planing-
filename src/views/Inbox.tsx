import { useCallback, useState, type ClipboardEvent, type DragEvent, type FormEvent } from 'react'
import { AgentBadge } from '../AgentBadge'
import { AssignedFace } from '../AssignedFace'
import { cardDropBind } from '../card-drop'
import { readMemberDrop } from '../member'
import { RoleChip } from '../RoleChip'
import { ReactionBar } from '../StickerBar'
import { filesToAttachments } from '../storage'
import { useStore } from '../store-context'
import type { Attachment } from '../types'
import { Icon } from '../ui/Icon'

export function Inbox({ onOpen }: { onOpen: (id: string) => void }) {
  const { state, addIdea, pullToSprint, moveItem, assignItem, toggleReaction } = useStore()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [authorId, setAuthorId] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [over, setOver] = useState(false)

  const addFiles = useCallback(async (list: FileList | File[]) => {
    const next = await filesToAttachments(list)
    setFiles((previous) => [...previous, ...next])
    if (next.length) setDetailsOpen(true)
  }, [])

  async function onPaste(event: ClipboardEvent) {
    const images = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'))
    if (!images.length) return
    event.preventDefault()
    await addFiles(images)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() && !body.trim() && !files.length) return
    addIdea({ title, body, attachments: files, authorId: authorId || null })
    setTitle('')
    setBody('')
    setFiles([])
    setDetailsOpen(false)
  }

  const ideas = state.items.filter((item) => item.lane === 'inbox' && !item.parentId)

  return (
    <section className="page inbox-page">
      <div className="page-head">
        <span className="eyebrow">Быстрый сбор</span>
        <h1>Входящие</h1>
        <p>Зафиксируйте мысль сейчас — разобрать и оценить её можно позже.</p>
      </div>

      <form
        className={`capture${over ? ' over' : ''}`}
        onSubmit={submit}
        onPaste={onPaste}
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={async (event: DragEvent) => {
          event.preventDefault()
          setOver(false)
          if (readMemberDrop(event)) return
          if (event.dataTransfer.files.length) await addFiles(event.dataTransfer.files)
        }}
      >
        <input
          className="capture-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onFocus={() => setDetailsOpen(true)}
          placeholder="Что случилось или что хотим?"
          aria-label="Название идеи"
        />
        {detailsOpen ? (
          <div className="capture-details">
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={3}
              placeholder="Контекст, ссылка или цитата из чата"
              aria-label="Контекст идеи"
            />
            <label className="capture-author">
              <span>Кто добавляет</span>
              <select
                value={authorId}
                onChange={(event) => setAuthorId(event.target.value)}
                aria-label="Кто добавляет на разбор"
              >
                <option value="">Не указано</option>
                {state.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            {files.length ? (
              <div className="thumbs">
                {files.map((file) => (
                  <figure key={file.id} className="thumb-item">
                    <img src={file.dataUrl} alt={file.name} />
                    <button
                      type="button"
                      className="thumb-remove"
                      onClick={() => setFiles((previous) => previous.filter((item) => item.id !== file.id))}
                      aria-label="Удалить картинку"
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </figure>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="capture-toolbar">
          <div>
            <button type="button" className="toolbar-button" onClick={() => setDetailsOpen((open) => !open)}>
              <Icon name="plus" />
              Контекст
            </button>
            <label className="toolbar-button">
              <Icon name="image" />
              Скриншот
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => event.target.files && addFiles(event.target.files)}
              />
            </label>
          </div>
          <button type="submit" className="primary-button">
            Добавить
            <Icon name="arrow" />
          </button>
        </div>
      </form>

      <div className="section-head">
        <h2>На разбор</h2>
        <span>{ideas.length}</span>
      </div>

      {ideas.length ? (
        <ul className="inbox-list">
          {ideas.map((item) => {
            const owner = state.members.find((member) => member.id === item.assigneeId)
            const author = state.members.find((member) => member.id === item.authorId)
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
                <div className="inbox-item-main">
                  <div className="task-title-line">
                    <button type="button" className="inbox-title" onClick={() => onOpen(item.id)}>
                      {item.title}
                    </button>
                    <AgentBadge item={item} compact />
                  </div>
                  {item.body ? <p>{item.body}</p> : null}
                  <div className="inbox-meta">
                    {author ? (
                      <span className="author-meta">
                        Добавил {author.name}
                        <RoleChip roleId={state.roles?.[author.id]} />
                      </span>
                    ) : null}
                    {item.attachments.length ? <span>{item.attachments.length} изобр.</span> : null}
                    <ReactionBar item={item} compact />
                  </div>
                </div>
                <div className="inbox-item-actions">
                  {owner ? <AssignedFace itemId={item.id} member={owner} /> : null}
                  <button type="button" className="secondary-button compact-button" onClick={() => moveItem(item.id, 'backlog', null)}>
                    В бэклог
                  </button>
                  <button type="button" className="primary-button compact-button" onClick={() => pullToSprint(item.id)}>
                    В спринт
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="empty-state small">
          <span><Icon name="inbox" /></span>
          <h2>Входящие разобраны</h2>
          <p>Новые идеи появятся здесь.</p>
        </div>
      )}
    </section>
  )
}
