import type { AppState, Criterion } from './types'
import { mondayOf, nextMonday, uid } from './dates'
import { defaultRoles } from './roles'

export const TEAM_MEMBERS = [
  { id: 'm1', name: 'Лиля', role: '', avatar: '/avatars/m1.png?v=2' },
  { id: 'm2', name: 'Ваня', role: '', avatar: '/avatars/m2.png?v=2' },
  { id: 'm3', name: 'Саша', role: '', avatar: '/avatars/m3.png?v=2' },
  { id: 'm4', name: 'Даша', role: '', avatar: '/avatars/m4.png?v=2' },
  { id: 'm5', name: 'Свят', role: '', avatar: '/avatars/m5.png?v=2' },
]

export const DEFAULT_CRITERIA: Criterion[] = [
  { id: 'c-reach', name: 'Охват', weight: 1, invert: false, hint: '', max: 3, step: 0.5 },
  { id: 'c-output', name: 'Выхлоп', weight: 1, invert: false, hint: '', max: 3, step: 0.5 },
  { id: 'c-focus', name: 'Фокус', weight: 1, invert: false, hint: '', max: 3, step: 0.5 },
  { id: 'c-agenda', name: 'Повестка', weight: 1, invert: false, hint: '', max: 3, step: 0.5 },
  { id: 'c-belief', name: 'Вера', weight: 1, invert: false, hint: '', max: 10, step: 1 },
  { id: 'c-strain', name: 'Напряг', weight: 1, invert: true, hint: 'Чем больше напряг — тем ниже итоговый балл', max: 10, step: 1 },
]

const LEGACY_SETS = [
  ['Ценность', 'Срочность', 'Усилие', 'Ясность'],
  ['Охват', 'На выходе', 'Стратегическая важность', 'Актуальность', 'Вера', 'Сложность (story points)'],
]

export function isLegacyCriteria(criteria: Criterion[] | undefined) {
  if (!criteria?.length) return true
  const names = criteria.map((c) => c.name)
  return LEGACY_SETS.some(
    (set) => set.length === names.length && set.every((name, i) => names[i] === name),
  )
}

function emptyBoard(): Omit<AppState, 'items' | 'comments'> {
  const week = mondayOf()
  const members = TEAM_MEMBERS
  return {
    updatedAt: Date.now(),
    members,
    currentMemberId: members[0].id,
    roles: defaultRoles(
      'crew',
      members.map((m) => m.id),
    ),
    criteria: DEFAULT_CRITERIA.map((c) => ({ ...c })),
    sprints: [
      {
        id: week,
        weekStart: week,
        goal: '',
        goalClosed: false,
        closed: false,
      },
    ],
  }
}

export function createEmpty(): AppState {
  return { ...emptyBoard(), items: [], comments: [] }
}

export function createSeed(): AppState {
  const week = mondayOf()
  const next = nextMonday(week)
  const members = TEAM_MEMBERS

  const i1 = uid()
  const i2 = uid()
  const i3 = uid()
  const i4 = uid()
  const i5 = uid()
  const i6 = uid()
  const i7 = uid()

  return {
    updatedAt: Date.now(),
    members,
    currentMemberId: members[0].id,
    roles: defaultRoles(
      'crew',
      members.map((m) => m.id),
    ),
    criteria: DEFAULT_CRITERIA.map((c) => ({ ...c })),
    sprints: [
      {
        id: week,
        weekStart: week,
        goal: 'Закрыть онбординг новых клиентов без ручных правок',
        goalClosed: false,
        closed: false,
      },
      {
        id: next,
        weekStart: next,
        goal: '',
        goalClosed: false,
        closed: false,
      },
    ],
    items: [
      {
        id: i1,
        title: 'Письмо после регистрации рвётся на мобиле',
        body: 'Клиент прислал скрин из почты. Нужно понять, это шаблон или клиентский клиент.',
        lane: 'inbox',
        sprintId: null,
        parentId: null,
        relatedIds: [],
        assigneeId: null,
        authorId: 'm5',
        scores: {},
        attachments: [],
        stickers: [],
        createdAt: Date.now() - 3600_000,
        archivedAt: null,
      },
      {
        id: i2,
        title: 'Идея: статус «ждём клиента» в карточке',
        body: 'Чтобы не держать задачу в работе, пока человек не ответил.',
        lane: 'inbox',
        sprintId: null,
        parentId: null,
        relatedIds: [],
        assigneeId: null,
        authorId: 'm1',
        scores: {},
        attachments: [],
        stickers: [],
        createdAt: Date.now() - 1800_000,
        archivedAt: null,
      },
      {
        id: i3,
        title: 'Автозаполнение реквизитов в онбординге',
        body: 'Сейчас менеджер копирует из письма. Это и есть главная дыра недели.',
        lane: 'todo',
        sprintId: week,
        parentId: null,
        relatedIds: [],
        assigneeId: 'm4',
        authorId: 'm1',
        scores: { c1: 5, c2: 5, c3: 3, c4: 4 },
        attachments: [],
        stickers: [
          { id: uid(), sticker: 'fire', by: 'm1', x: 68, y: 6, rot: -14, scale: 1.1 },
          { id: uid(), sticker: 'up', by: 'm5', x: 8, y: 62, rot: 11, scale: 0.92 },
        ],
        createdAt: Date.now() - 86400_000,
        archivedAt: null,
      },
      {
        id: i4,
        title: 'Проверка шагов онбординга на стейдже',
        body: 'Сценарий: новый юр. адрес, иностранный номер, пустой ИНН.',
        lane: 'doing',
        sprintId: week,
        parentId: null,
        relatedIds: [],
        assigneeId: 'm5',
        authorId: 'm5',
        scores: { c1: 4, c2: 4, c3: 2, c4: 5 },
        attachments: [],
        stickers: [],
        createdAt: Date.now() - 80000_000,
        archivedAt: null,
      },
      {
        id: i5,
        title: 'Подсказки в форме, если банк не находится',
        body: 'Частый вопрос в чате. Можно закрыть текстом, не кодом.',
        lane: 'backlog',
        sprintId: null,
        parentId: null,
        relatedIds: [],
        assigneeId: 'm1',
        authorId: 'm1',
        scores: { c1: 4, c2: 3, c3: 2, c4: 5 },
        attachments: [],
        stickers: [],
        createdAt: Date.now() - 172800_000,
        archivedAt: null,
      },
      {
        id: i6,
        title: 'Экспорт заявок в таблицу для продаж',
        body: 'Просили «как в прошлом квартале». Не цель этой недели.',
        lane: 'backlog',
        sprintId: null,
        parentId: null,
        relatedIds: [],
        assigneeId: null,
        authorId: 'm2',
        scores: { c1: 2, c2: 2, c3: 4, c4: 3 },
        attachments: [],
        stickers: [],
        createdAt: Date.now() - 200000_000,
        archivedAt: null,
      },
      {
        id: i7,
        title: 'Починить превью логотипа в шапке заявки',
        body: 'Уже на стейдже, осталось прогнать.',
        lane: 'done',
        sprintId: week,
        parentId: null,
        relatedIds: [],
        assigneeId: 'm3',
        authorId: 'm3',
        scores: { c1: 3, c2: 3, c3: 1, c4: 5 },
        attachments: [],
        stickers: [],
        createdAt: Date.now() - 90000_000,
        archivedAt: null,
      },
    ],
    comments: [
      {
        id: uid(),
        itemId: i3,
        authorId: 'm1',
        text: 'Если не успеем API — оставляем ручной ввод, но подсвечиваем пустые поля.',
        createdAt: Date.now() - 4000_000,
      },
    ],
  }
}
