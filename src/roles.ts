export const WEEK_ROLES = [
  {
    id: 'geek',
    name: 'Гик',
    tag: 'гик',
    hint: 'Собирает интересные находки из открытых чатов, каналов и других источников.',
  },
  {
    id: 'rescuer',
    name: 'Спасатель',
    tag: 'спасатель',
    hint: 'Вытаскивает боли и обратную связь пользователей из исследований.',
  },
  {
    id: 'maker',
    name: 'Творец',
    tag: 'творец',
    hint: 'Ищет UX/UI-улучшения в продуктах Дейли Банкинга.',
  },
  {
    id: 'dreamer',
    name: 'Фантазер',
    tag: 'фантазер',
    hint: 'Ищет улучшения внутри наших продуктов: UX/UI и инструменты команды.',
  },
  {
    id: 'hustler',
    name: 'Суетолог',
    tag: 'суетолог',
    hint: 'Регулярно собирает идеи у других команд.',
  },
  {
    id: 'strategist',
    name: 'Стратег',
    tag: 'стратег',
    hint: 'Собирает идеи из стратегий и целей топов.',
  },
] as const

export type RoleId = (typeof WEEK_ROLES)[number]['id']

export type RoleMap = Record<string, RoleId>

export function roleById(id: string | undefined | null) {
  return WEEK_ROLES.find((r) => r.id === id) ?? null
}

function hash(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function shuffle<T>(items: T[], rand: () => number) {
  const next = [...items]
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

function mulberry32(seed: number) {
  let t = seed
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export function assignRoles(memberIds: string[], rand: () => number = Math.random): RoleMap {
  const ids = WEEK_ROLES.map((r) => r.id)
  const shuffled = shuffle(ids, rand)
  const roles: RoleMap = {}
  memberIds.forEach((memberId, i) => {
    const role = shuffled[i]
    if (role) roles[memberId] = role
  })
  return roles
}

export function defaultRoles(weekId: string, memberIds: string[]) {
  return assignRoles(memberIds, mulberry32(hash(weekId)))
}

export function rollRoles(memberIds: string[]) {
  return assignRoles(memberIds)
}

export function chipStickerPose(seed: string) {
  const rand = mulberry32(hash(`chip:${seed}`))
  return {
    top: rand() < 0.5,
    shift: -8 + rand() * 16,
    rot: -8 + rand() * 16,
  }
}
