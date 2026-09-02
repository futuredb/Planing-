import { useMemo, useState } from 'react'
import { Avatar } from './Avatar'
import { sprintName, weekLabel } from './dates'
import { RoleChip } from './RoleChip'
import { ReactionSources } from './StickerBar'
import { useStore } from './store-context'
import { Icon, type IconName } from './ui/Icon'
import { Archive } from './views/Archive'
import { Backlog } from './views/Backlog'
import { Drawer } from './views/Drawer'
import { Graph } from './views/Graph'
import { Inbox } from './views/Inbox'
import { Sprint } from './views/Sprint'
import { Team } from './views/Team'

const views = [
  { id: 'sprint', label: 'Спринт', icon: 'sprint' },
  { id: 'backlog', label: 'Бэклог', icon: 'backlog' },
  { id: 'inbox', label: 'Входящие', icon: 'inbox' },
  { id: 'team', label: 'Команда', icon: 'team' },
  { id: 'graph', label: 'Граф', icon: 'graph' },
  { id: 'archive', label: 'Архив', icon: 'archive' },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: IconName }>

type ViewId = (typeof views)[number]['id']

export default function App() {
  const {
    state,
    weekId,
    liveWeek,
    shiftWeek,
    goThisWeek,
    rollWeekRoles,
  } = useStore()
  const [view, setView] = useState<ViewId>('sprint')
  const [openId, setOpenId] = useState<string | null>(null)
  const [confirmRoles, setConfirmRoles] = useState(false)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const openItem = useMemo(
    () => state.items.find((item) => item.id === openId) ?? null,
    [openId, state.items],
  )

  function navigate(next: ViewId) {
    setView(next)
    setMobileMoreOpen(false)
  }

  function navButton(item: (typeof views)[number], mobile = false) {
    return (
      <button
        key={`${mobile ? 'mobile-' : ''}${item.id}`}
        type="button"
        className={`nav-item${view === item.id ? ' active' : ''}`}
        onClick={() => navigate(item.id)}
        aria-current={view === item.id ? 'page' : undefined}
        title={item.label}
      >
        <Icon name={item.icon} size={mobile ? 20 : 19} />
        <span>{item.label}</span>
      </button>
    )
  }

  return (
    <div className="app-shell">
      <aside className="side-nav" aria-label="Основная навигация">
        <button type="button" className="brand" onClick={() => navigate('sprint')} aria-label="Funban — к спринту">
          <img className="brand-mark" src="/funban-logo.png" alt="" />
          <span className="brand-name">Funban</span>
        </button>
        <nav className="nav-list">{views.map((item) => navButton(item))}</nav>
        <div className="side-note">
          <span className="presence-dot" />
          <span>Планирование по вторникам</span>
        </div>
      </aside>

      <header className="context-bar">
        <div className="week-switcher">
          <button type="button" className="icon-button" onClick={() => shiftWeek(-1)} aria-label="Предыдущая неделя">
            <Icon name="left" />
          </button>
          <div className="week-copy">
            <strong>{sprintName(weekId)}</strong>
            <span>{weekLabel(weekId)}</span>
            {!liveWeek ? (
              <button type="button" className="text-button" onClick={goThisWeek}>
                Сегодня
              </button>
            ) : null}
          </div>
          <button type="button" className="icon-button" onClick={() => shiftWeek(1)} aria-label="Следующая неделя">
            <Icon name="right" />
          </button>
        </div>

        <div className="header-tools">
          <ReactionSources />
          <span className="header-tool-divider" aria-hidden="true" />
          <div className="roles-wrap" aria-label="Роли команды на выбранной неделе">
            <div className="role-source-list">
              {state.members.map((member) => (
                <div
                  className="role-drag-source"
                  key={member.id}
                  title={`${member.name}: перетащите аватар на карточку`}
                >
                  <Avatar member={member} size="sm" draggable />
                  <RoleChip roleId={state.roles?.[member.id]} />
                </div>
              ))}
            </div>
            <button
              type="button"
              className="icon-button roles-shuffle-button"
              onClick={() => setConfirmRoles(true)}
              aria-label="Перемешать роли…"
              title="Перемешать роли"
            >
              <Icon name="dice" />
            </button>
          </div>
        </div>
      </header>

      <div className="app-main">
        <main id="main-content" className="view-enter" key={view}>
          {view === 'sprint' ? <Sprint onOpen={setOpenId} /> : null}
          {view === 'backlog' ? <Backlog onOpen={setOpenId} /> : null}
          {view === 'inbox' ? <Inbox onOpen={setOpenId} /> : null}
          {view === 'team' ? <Team onShuffle={() => setConfirmRoles(true)} /> : null}
          {view === 'graph' ? <Graph onOpen={setOpenId} /> : null}
          {view === 'archive' ? <Archive onOpen={setOpenId} /> : null}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Мобильная навигация">
        {views.slice(0, 4).map((item) => navButton(item, true))}
        <button
          type="button"
          className={`nav-item${view === 'graph' || view === 'archive' ? ' active' : ''}`}
          onClick={() => setMobileMoreOpen((open) => !open)}
          aria-expanded={mobileMoreOpen}
        >
          <Icon name="more" size={20} />
          <span>Ещё</span>
        </button>
      </nav>

      {mobileMoreOpen ? (
        <div className="mobile-more" role="menu">
          {views.slice(4).map((item) => navButton(item, true))}
        </div>
      ) : null}

      {openItem ? (
        <Drawer key={openItem.id} item={openItem} onOpen={setOpenId} onClose={() => setOpenId(null)} />
      ) : null}

      {confirmRoles ? (
        <div className="confirm-backdrop" onClick={() => setConfirmRoles(false)}>
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="shuffle-roles-title"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="confirm-icon"><Icon name="dice" /></span>
            <h2 id="shuffle-roles-title">Перемешать роли?</h2>
            <p>
              Текущее распределение на {weekLabel(weekId)} будет заменено. Новые роли
              останутся закреплены до следующего планирования во вторник.
            </p>
            <div className="dialog-actions">
              <button type="button" className="secondary-button" onClick={() => setConfirmRoles(false)}>
                Оставить как есть
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  rollWeekRoles()
                  setConfirmRoles(false)
                }}
              >
                Перемешать
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
