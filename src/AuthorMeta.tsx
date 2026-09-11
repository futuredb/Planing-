import type { Item, Member } from './types'

export function AuthorMeta({
  item,
  members,
  compact = false,
}: {
  item: Item
  members: Member[]
  compact?: boolean
}) {
  const author = members.find((member) => member.id === item.authorId)
  if (!author) return null

  return (
    <span
      className={`author-meta${compact ? ' compact' : ''}`}
      aria-label={`Автор задачи: ${author.name}`}
    >
      Автор <span aria-hidden="true">·</span> {author.name}
    </span>
  )
}
