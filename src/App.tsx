import { useMemo, useState } from 'react'
import { Avatar, readMemberFromItem } from './Avatar'
import { weekLabel } from './dates'
import { RoleChip } from './RoleChip'
import { useStore } from './store'
import { markDropConsumed } from './detach'
import { Inbox } from './views/Inbox'
import { Backlog } from './views/Backlog'
import { Sprint } from './views/Sprint'
import { Team } from './views/Team'
import { Drawer } from './views/Drawer'
import { StickerRail } from './StickerBar'

const views = [
  { id: 'sprint', label: 'Спринт' },
  { id: 'backlog', label: 'Бэклог' },
  { id: 'inbox', label: 'Входящие' },
  { id: 'team', label: 'Команда' },
] as const

type ViewId = (typeof views)[number]['id']

export default function App() {
  const { state, weekId, liveWeek, shiftWeek, goThisWeek, setCurrentMember, assignItem, rollWeekRoles } =
    useStore()
  const [view, setView] = useState<ViewId>('sprint')
  const [openId, setOpenId] = useState<string | null>(null)
  const sprint = state.sprints.find((s) => s.id === weekId)
  const openItem = useMemo(
    () => state.items.find((it) => it.id === openId) ?? null,
    [openId, state.items],
  )

  return (
    <div className="shell">
      <header className="top">
        <div className="week-block">
          <div className="week-nav">
            <button type="button" className="ghost week-btn" onClick={() => shiftWeek(-1)} aria-label="Предыдущая неделя">
              ‹
            </button>
            <div>
              <h1>Неделя {weekLabel(weekId)}</h1>
              {liveWeek ? (
                <p className="week-now">эта неделя</p>
              ) : (
                <button type="button" className="link week-now" onClick={goThisWeek}>
                  к текущей неделе
                </button>
              )}
            </div>
            <button type="button" className="ghost week-btn" onClick={() => shiftWeek(1)} aria-label="Следующая неделя">
              ›
            </button>
          </div>
        </div>
        <nav className="tabs">
          {views.map((v) => (
            <button
              key={v.id}
              className={view === v.id ? 'tab on' : 'tab'}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <div
          className="crew"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const fromItem = readMemberFromItem(e)
            if (!fromItem) return
            e.preventDefault()
            markDropConsumed()
            assignItem(fromItem, null)
          }}
        >
          {state.members.map((m) => (
            <div key={m.id} className="crew-person">
              <Avatar
                member={m}
                size="lg"
                draggable
                current={state.currentMemberId === m.id}
                onPick={() => setCurrentMember(m.id)}
              />
              <RoleChip
                roleId={sprint?.roles?.[m.id]}
                sticker={`${weekId}-${m.id}-${sprint?.roles?.[m.id] ?? ''}`}
              />
            </div>
          ))}
          <button
            type="button"
            className="dice-btn"
            onClick={rollWeekRoles}
            aria-label="Раскидать роли на неделю"
            title="Раскидать роли"
          >
            <img src="/dice.svg" alt="" />
          </button>
        </div>
      </header>

      <div className="workspace">
        <StickerRail />
        <div className="workspace-main">
      {sprint?.goalClosed ? (
        <p className="banner ok">Цель недели закрыта.</p>
      ) : null}

      <main>
        {view === 'sprint' ? <Sprint onOpen={setOpenId} /> : null}
        {view === 'backlog' ? <Backlog onOpen={setOpenId} /> : null}
        {view === 'inbox' ? <Inbox onOpen={setOpenId} /> : null}
        {view === 'team' ? <Team /> : null}
      </main>
        </div>
      </div>

      {openItem ? <Drawer item={openItem} onClose={() => setOpenId(null)} /> : null}
    </div>
  )
}
