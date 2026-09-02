import { useMemo, useState } from 'react'
import { Avatar } from './Avatar'
import { sprintName, weekLabel } from './dates'
import { RoleChip } from './RoleChip'
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
  const [rolesOpen, setRolesOpen] = useState(false)
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
          <span className="brand-mark">F</span>
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

        <div className="roles-wrap">
            <button
              type="button"
              className="roles-button"
              onClick={() => setRolesOpen((open) => !open)}
              aria-expanded={rolesOpen}
              aria-haspopup="dialog"
            >
              <span className="avatar-stack" aria-hidden="true">
                {state.members.slice(0, 3).map((member) => (
                  <Avatar key={member.id} member={member} size="sm" />
                ))}
              </span>
              <span className="roles-copy">
                <small>{liveWeek ? 'Эта неделя' : 'Выбранная неделя'}</small>
                <strong>Роли команды</strong>
              </span>
              <Icon name="more" />
            </button>
            {rolesOpen ? (
              <div className="crew-popover" role="dialog" aria-label="Роли этой недели">
                <div className="popover-head">
                  <div>
                    <strong>Роли этой недели</strong>
                    <span>Распределяются на планировании во вторник и действуют всю неделю.</span>
                  </div>
                  <button type="button" className="icon-button" onClick={() => setRolesOpen(false)} aria-label="Закрыть">
                    <Icon name="close" />
                  </button>
                </div>
                <div className="crew-list">
                  {state.members.map((member) => (
                    <div className="crew-option" key={member.id}>
                      <Avatar member={member} size="md" />
                      <span>
                        <strong>{member.name}</strong>
                        <RoleChip roleId={state.roles?.[member.id]} />
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="secondary-button popover-action"
                  onClick={() => {
                    setRolesOpen(false)
                    setConfirmRoles(true)
                  }}
                >
                  <Icon name="dice" />
                  Перемешать роли…
                </button>
              </div>
            ) : null}
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
