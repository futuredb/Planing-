import type { Item } from './types'
import { Icon } from './ui/Icon'

export function AgentBadge({ item, compact = false }: { item: Item; compact?: boolean }) {
  if (item.createdVia !== 'agent') return null

  return (
    <span
      className={`agent-badge${compact ? ' compact' : ''}`}
      title="Задача создана через AI-агента"
      aria-label="Задача создана через AI-агента"
    >
      <Icon name="agent" size={compact ? 12 : 13} />
      Агент
    </span>
  )
}
