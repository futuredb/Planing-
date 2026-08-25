import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { mondayOf, nextMonday, shiftMonday, uid } from './dates'
import { itemScore, loadState, saveState } from './storage'
import type { AppState, Attachment, Criterion, Item, Lane } from './types'
import type { StickerId } from './stickers'
import { defaultRoles, rollRoles } from './roles'

type Store = {
  state: AppState
  weekId: string
  liveWeek: boolean
  shiftWeek: (dir: -1 | 1) => void
  goThisWeek: () => void
  setCurrentMember: (id: string) => void
  patchMember: (id: string, patch: { name?: string; role?: string; avatar?: string }) => void
  assignItem: (itemId: string, memberId: string | null, fromItemId?: string | null) => void
  setGoal: (text: string) => void
  toggleGoalClosed: () => void
  addIdea: (input: { title: string; body: string; attachments: Attachment[] }) => void
  updateItem: (id: string, patch: Partial<Item>) => void
  removeItem: (id: string) => void
  moveItem: (id: string, lane: Lane, sprintId?: string | null) => void
  pullToSprint: (id: string) => void
  carryOver: (id: string) => void
  decompose: (id: string, titles: string[]) => void
  linkTasks: (id: string, titles: string[]) => void
  unlinkTask: (id: string, otherId: string) => void
  setScore: (itemId: string, criterionId: string, value: number) => void
  addComment: (itemId: string, text: string) => void
  addCriterion: () => void
  updateCriterion: (id: string, patch: Partial<Criterion>) => void
  removeCriterion: (id: string) => void
  closeSprint: () => void
  rollWeekRoles: () => void
  stickSticker: (
    itemId: string,
    sticker: StickerId,
    place: { x: number; y: number; rot: number; scale: number },
    from?: { itemId: string; placedId: string; rot: number; scale: number },
  ) => void
  peelSticker: (itemId: string, placedId: string) => void
  scoreOf: (item: Item) => number
}

const StoreContext = createContext<Store | null>(null)

function bump(state: AppState): AppState {
  return { ...state, updatedAt: Date.now() }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null)
  const skipSave = useRef(true)

  useEffect(() => {
    loadState().then(setState)
  }, [])

  useEffect(() => {
    if (!state) return
    if (skipSave.current) {
      skipSave.current = false
      return
    }
    const t = setTimeout(() => {
      void saveState(state)
    }, 250)
    return () => clearTimeout(t)
  }, [state])

  const mutate = useCallback((fn: (prev: AppState) => AppState) => {
    setState((prev) => (prev ? bump(fn(prev)) : prev))
  }, [])

  const [weekId, setWeekId] = useState(mondayOf)
  const liveWeek = weekId === mondayOf()

  const api = useMemo<Store | null>(() => {
    if (!state) return null

    const withWeek = (prev: AppState, id: string) => {
      if (prev.sprints.some((s) => s.id === id)) return prev
      return {
        ...prev,
        sprints: [
          ...prev.sprints,
          {
            id,
            weekStart: id,
            goal: '',
            goalClosed: false,
            closed: false,
            roles: defaultRoles(
              id,
              prev.members.map((m) => m.id),
            ),
          },
        ],
      }
    }

    const ensureNext = (prev: AppState) => withWeek(prev, nextMonday(weekId))

    return {
      state,
      weekId,
      liveWeek,
      shiftWeek: (dir) => {
        const next = shiftMonday(weekId, dir)
        setWeekId(next)
        setState((prev) => {
          if (!prev) return prev
          const updated = withWeek(prev, next)
          return updated === prev ? prev : bump(updated)
        })
      },
      goThisWeek: () => {
        const now = mondayOf()
        setWeekId(now)
        setState((prev) => {
          if (!prev) return prev
          const updated = withWeek(prev, now)
          return updated === prev ? prev : bump(updated)
        })
      },
      setCurrentMember: (id) => mutate((s) => ({ ...s, currentMemberId: id })),
      patchMember: (id, patch) =>
        mutate((s) => ({
          ...s,
          members: s.members.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        })),
      assignItem: (itemId, memberId, fromItemId) =>
        mutate((s) => ({
          ...s,
          items: s.items.map((it) => {
            if (it.id === itemId) return { ...it, assigneeId: memberId }
            if (fromItemId && it.id === fromItemId && fromItemId !== itemId) {
              return { ...it, assigneeId: null }
            }
            return it
          }),
        })),
      setGoal: (text) =>
        mutate((s) => ({
          ...s,
          sprints: s.sprints.map((sp) => (sp.id === weekId ? { ...sp, goal: text } : sp)),
        })),
      toggleGoalClosed: () =>
        mutate((s) => ({
          ...s,
          sprints: s.sprints.map((sp) =>
            sp.id === weekId ? { ...sp, goalClosed: !sp.goalClosed } : sp,
          ),
        })),
      addIdea: ({ title, body, attachments }) =>
        mutate((s) => ({
          ...s,
          items: [
            {
              id: uid(),
              title: title.trim() || 'Без названия',
              body,
              lane: 'inbox',
              sprintId: null,
              parentId: null,
              assigneeId: null,
              authorId: s.currentMemberId,
              scores: {},
              attachments,
              stickers: [],
              relatedIds: [],
              createdAt: Date.now(),
            },
            ...s.items,
          ],
        })),
      updateItem: (id, patch) =>
        mutate((s) => ({
          ...s,
          items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
        })),
      removeItem: (id) =>
        mutate((s) => ({
          ...s,
          items: s.items
            .filter((it) => it.id !== id && it.parentId !== id)
            .map((it) => ({
              ...it,
              relatedIds: (it.relatedIds ?? []).filter((rid) => rid !== id),
            })),
          comments: s.comments.filter((c) => c.itemId !== id),
        })),
      moveItem: (id, lane, sprintId) =>
        mutate((s) => ({
          ...s,
          items: s.items.map((it) =>
            it.id === id
              ? {
                  ...it,
                  lane,
                  sprintId: sprintId === undefined ? it.sprintId : sprintId,
                }
              : it,
          ),
        })),
      pullToSprint: (id) =>
        mutate((s) => ({
          ...s,
          items: s.items.map((it) =>
            it.id === id ? { ...it, lane: 'todo', sprintId: weekId } : it,
          ),
        })),
      carryOver: (id) =>
        mutate((s) => {
          const next = nextMonday(weekId)
          const withSprint = ensureNext(s)
          return {
            ...withSprint,
            items: withSprint.items.map((it) =>
              it.id === id ? { ...it, lane: 'todo', sprintId: next } : it,
            ),
          }
        }),
      decompose: (id, titles) =>
        mutate((s) => {
          const parent = s.items.find((it) => it.id === id)
          if (!parent) return s
          const children: Item[] = titles
            .map((t) => t.trim())
            .filter(Boolean)
            .map((title) => ({
              id: uid(),
              title,
              body: `Часть задачи: ${parent.title}`,
              lane: 'todo',
              sprintId: parent.sprintId ?? weekId,
              parentId: parent.id,
              assigneeId: null,
              authorId: s.currentMemberId,
              scores: { ...parent.scores },
              attachments: [],
              stickers: [],
              relatedIds: [],
              createdAt: Date.now(),
            }))
          return {
            ...s,
            items: s.items.map((it) =>
              it.id === id
                ? { ...it, lane: it.lane === 'inbox' ? 'backlog' : it.lane }
                : it,
            ).concat(children),
          }
        }),
      linkTasks: (id, titles) =>
        mutate((s) => {
          const origin = s.items.find((it) => it.id === id)
          if (!origin) return s
          let items = s.items.map((it) => ({
            ...it,
            relatedIds: it.relatedIds ?? [],
          }))
          for (const raw of titles) {
            const title = raw.trim()
            if (!title) continue
            let other = items.find(
              (it) => it.id !== id && it.title.toLowerCase() === title.toLowerCase(),
            )
            if (!other) {
              other = {
                id: uid(),
                title,
                body: '',
                lane: origin.lane === 'inbox' ? 'backlog' : origin.lane,
                sprintId: origin.sprintId,
                parentId: null,
                relatedIds: [],
                assigneeId: null,
                authorId: s.currentMemberId,
                scores: {},
                attachments: [],
                stickers: [],
                createdAt: Date.now(),
              }
              items = [...items, other]
            }
            const otherId = other.id
            items = items.map((it) => {
              if (it.id === id && !it.relatedIds.includes(otherId)) {
                return { ...it, relatedIds: [...it.relatedIds, otherId] }
              }
              if (it.id === otherId && !it.relatedIds.includes(id)) {
                return { ...it, relatedIds: [...it.relatedIds, id] }
              }
              return it
            })
          }
          return { ...s, items }
        }),
      unlinkTask: (id, otherId) =>
        mutate((s) => ({
          ...s,
          items: s.items.map((it) => {
            if (it.id === id) {
              return { ...it, relatedIds: (it.relatedIds ?? []).filter((rid) => rid !== otherId) }
            }
            if (it.id === otherId) {
              return { ...it, relatedIds: (it.relatedIds ?? []).filter((rid) => rid !== id) }
            }
            return it
          }),
        })),
      setScore: (itemId, criterionId, value) =>
        mutate((s) => ({
          ...s,
          items: s.items.map((it) =>
            it.id === itemId
              ? { ...it, scores: { ...it.scores, [criterionId]: value } }
              : it,
          ),
        })),
      addComment: (itemId, text) =>
        mutate((s) => ({
          ...s,
          comments: [
            ...s.comments,
            {
              id: uid(),
              itemId,
              authorId: s.currentMemberId,
              text: text.trim(),
              createdAt: Date.now(),
            },
          ],
        })),
      addCriterion: () =>
        mutate((s) => ({
          ...s,
          criteria: [
            ...s.criteria,
            {
              id: uid(),
              name: 'Новый критерий',
              weight: 1,
              invert: false,
              hint: '',
            },
          ],
        })),
      updateCriterion: (id, patch) =>
        mutate((s) => ({
          ...s,
          criteria: s.criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),
      removeCriterion: (id) =>
        mutate((s) => ({
          ...s,
          criteria: s.criteria.filter((c) => c.id !== id),
        })),
      closeSprint: () =>
        mutate((s) => {
          const next = nextMonday(weekId)
          const withSprint = ensureNext(s)
          return {
            ...withSprint,
            sprints: withSprint.sprints.map((sp) =>
              sp.id === weekId ? { ...sp, closed: true } : sp,
            ),
            items: withSprint.items.map((it) =>
              it.sprintId === weekId && it.lane !== 'done'
                ? { ...it, lane: 'todo', sprintId: next }
                : it,
            ),
          }
        }),
      rollWeekRoles: () =>
        mutate((s) => ({
          ...s,
          sprints: s.sprints.map((sp) =>
            sp.id === weekId
              ? { ...sp, roles: rollRoles(s.members.map((m) => m.id)) }
              : sp,
          ),
        })),
      stickSticker: (itemId, sticker, place, from) =>
        mutate((s) => ({
          ...s,
          items: s.items.map((it) => {
            let stickers = [...(it.stickers ?? [])]
            if (from && it.id === from.itemId) {
              stickers = stickers.filter((st) => st.id !== from.placedId)
            }
            if (it.id === itemId) {
              stickers = [
                ...stickers.filter((st) => st.id !== from?.placedId),
                {
                  id: from?.placedId ?? uid(),
                  sticker,
                  by: s.currentMemberId,
                  x: place.x,
                  y: place.y,
                  rot: from?.rot ?? place.rot,
                  scale: from?.scale ?? place.scale,
                },
              ]
            }
            return { ...it, stickers }
          }),
        })),
      peelSticker: (itemId, placedId) =>
        mutate((s) => ({
          ...s,
          items: s.items.map((it) =>
            it.id === itemId
              ? { ...it, stickers: (it.stickers ?? []).filter((st) => st.id !== placedId) }
              : it,
          ),
        })),
      scoreOf: (item) => itemScore(item, state.criteria),
    }
  }, [mutate, state, weekId, liveWeek])

  if (!api) {
    return <div className="boot">Собираем доску…</div>
  }

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('Store missing')
  return ctx
}
