import type { RoleMap } from './roles'
import type { StickerId } from './stickers'

export type Lane = 'inbox' | 'backlog' | 'todo' | 'doing' | 'done'

export type Member = {
  id: string
  name: string
  role: string
  avatar: string
}

export type Criterion = {
  id: string
  name: string
  weight: number
  invert: boolean
  hint: string
}

export type Sprint = {
  id: string
  weekStart: string
  goal: string
  goalClosed: boolean
  closed: boolean
  roles: RoleMap
}

export type Attachment = {
  id: string
  name: string
  mime: string
  dataUrl: string
}

export type Item = {
  id: string
  title: string
  body: string
  lane: Lane
  sprintId: string | null
  parentId: string | null
  assigneeId: string | null
  authorId: string | null
  scores: Record<string, number>
  attachments: Attachment[]
  stickers: PlacedSticker[]
  createdAt: number
}

export type PlacedSticker = {
  id: string
  sticker: StickerId
  by: string
  x: number
  y: number
  rot: number
  scale: number
}

export type Comment = {
  id: string
  itemId: string
  authorId: string
  text: string
  createdAt: number
}

export type AppState = {
  updatedAt: number
  members: Member[]
  currentMemberId: string
  criteria: Criterion[]
  sprints: Sprint[]
  items: Item[]
  comments: Comment[]
}
