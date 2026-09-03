import { expect, test, type Page } from '@playwright/test'
import { createSeed } from '../src/seed'

const consoleErrors = new Map<Page, string[]>()

async function seed(page: Page) {
  const response = await page.request.put('/api/state', { data: createSeed() })
  expect(response.ok()).toBeTruthy()
}

async function expectNoPageOverflow(page: Page) {
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBe(0)
}

test.beforeEach(async ({ page }) => {
  consoleErrors.set(page, [])
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.get(page)?.push(message.text())
  })
  await seed(page)
  await page.goto('/')
  await expect(page.getByText('Закрыть онбординг новых клиентов без ручных правок')).toBeVisible()
})

test.afterEach(async ({ page }) => {
  expect(consoleErrors.get(page), 'В браузерной консоли не должно быть ошибок').toEqual([])
  consoleErrors.delete(page)
})

test('логотип продукта загружается в навигации и favicon', async ({ page }) => {
  const logo = page.locator('.brand-mark')
  await expect(logo).toHaveAttribute('src', '/funban-logo.png')
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBeTruthy()
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/funban-logo.png')
})

test('основные разделы не создают глобальный горизонтальный скролл', async ({ page }) => {
  await expectNoPageOverflow(page)

  for (const section of ['Бэклог', 'Входящие', 'Команда']) {
    await page.getByRole('button', { name: section, exact: true }).click()
    await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible()
    await expectNoPageOverflow(page)
  }
})

test('длинная цель недели растёт по высоте и не ломает сводку', async ({ page }) => {
  const goal = page.getByLabel('Цель недели')
  await goal.fill(
    'Подготовить онбординг новых клиентов без ручных правок и проверить все спорные сценарии вместе с командой до конца недели',
  )

  await expect
    .poll(() => goal.evaluate((element) => element.scrollHeight <= element.clientHeight + 1))
    .toBeTruthy()

  const layoutIsIntact = await page.locator('.sprint-summary').evaluate((summary) => {
    const label = summary.querySelector<HTMLElement>('.eyebrow')
    const textarea = summary.querySelector<HTMLTextAreaElement>('textarea')
    const actions = summary.querySelector<HTMLElement>('.summary-actions')
    if (!label || !textarea || !actions) return false

    const summaryBox = summary.getBoundingClientRect()
    const labelBox = label.getBoundingClientRect()
    const textareaBox = textarea.getBoundingClientRect()
    const actionsBox = actions.getBoundingClientRect()

    return (
      textareaBox.top >= labelBox.bottom &&
      actionsBox.left >= summaryBox.left &&
      actionsBox.right <= summaryBox.right &&
      actionsBox.bottom <= summaryBox.bottom
    )
  })

  expect(layoutIsIntact).toBeTruthy()
  await expectNoPageOverflow(page)
})

test('доска фильтруется по одному или нескольким исполнителям', async ({ page }) => {
  const dasha = page.getByRole('button', { name: 'Фильтр по исполнителю: Даша' })
  const svyat = page.getByRole('button', { name: 'Фильтр по исполнителю: Свят' })
  const all = page.getByRole('button', { name: 'Показать все задачи' })

  await expect(page.locator('.assignee-filter img')).toHaveCount(0)
  await dasha.click()
  await expect(dasha).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Автозаполнение реквизитов в онбординге', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Проверка шагов онбординга на стейдже', exact: true })).toBeHidden()
  await expect(page.locator('[data-lane="todo"] .column-head > span')).toHaveText('1')
  await expect(page.locator('[data-lane="doing"] .column-head > span')).toHaveText('0')

  await svyat.click()
  await expect(svyat).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Проверка шагов онбординга на стейдже', exact: true })).toBeVisible()
  await expect(page.locator('[data-lane="todo"] .column-head > span')).toHaveText('1')
  await expect(page.locator('[data-lane="doing"] .column-head > span')).toHaveText('1')

  await all.click()
  await expect(all).toHaveAttribute('aria-pressed', 'true')
  await expect(dasha).toHaveAttribute('aria-pressed', 'false')
  await expect(svyat).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'Починить превью логотипа в шапке заявки', exact: true })).toBeVisible()
  await expectNoPageOverflow(page)
})

test('задача двигается по спринту и реакция сохраняется', async ({ page }) => {
  const card = page.locator('.task-card').filter({ hasText: 'Автозаполнение реквизитов' })
  await card.getByLabel('Добавить реакцию').click()
  await page.getByRole('menuitem', { name: 'звезда' }).click()
  await expect(card.getByLabel(/звезда, реакций:/)).toBeVisible()

  await card.getByLabel('Действия с задачей').click()
  await page.getByRole('button', { name: 'В «В работе»' }).click()
  await expect(page.locator('[data-lane="doing"]')).toContainText('Автозаполнение реквизитов')

  await page.waitForTimeout(400)
  await page.reload()
  const movedCard = page.locator('[data-lane="doing"] .task-card').filter({ hasText: 'Автозаполнение реквизитов' })
  await expect(movedCard.getByLabel(/звезда, реакций:/)).toBeVisible()
})

test('роли видны в шапке, а аватар назначает исполнителя перетаскиванием', async ({ page }) => {
  const rolesDock = page.getByLabel('Роли команды на выбранной неделе')
  const roleChips = rolesDock.locator('.role-chip')
  await expect(roleChips).toHaveCount(5)
  await expect(roleChips.first()).toBeVisible()
  expect((await roleChips.allTextContents()).every((role) => role.trim().length > 0)).toBeTruthy()
  await expect(page.getByRole('dialog', { name: 'Роли этой недели' })).toHaveCount(0)

  await rolesDock.getByRole('button', { name: 'Перемешать роли…', exact: true }).click()
  const confirmation = page.getByRole('alertdialog', { name: 'Перемешать роли?' })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Оставить как есть' }).click()

  const source = rolesDock.getByRole('button', {
    name: 'Перетащить Лиля на карточку',
    exact: true,
  })
  const card = page.locator('.task-card').filter({ hasText: 'Автозаполнение реквизитов' })
  await source.dragTo(card)
  await expect(card.locator('.owner-chip')).toContainText('Лиля')

  await page.waitForTimeout(400)
  await page.reload()
  const savedCard = page.locator('.task-card').filter({ hasText: 'Автозаполнение реквизитов' })
  await expect(savedCard.locator('.owner-chip')).toContainText('Лиля')
})

test('реакция из шапки добавляется на карточку перетаскиванием', async ({ page }) => {
  const source = page
    .getByLabel('Реакции для перетаскивания')
    .getByRole('img', { name: 'Перетащить реакцию «звезда» на карточку' })
  const card = page.locator('.task-card').filter({ hasText: 'Автозаполнение реквизитов' })

  await source.dragTo(card)
  await expect(card.getByLabel(/звезда, реакций:/)).toBeVisible()

  await page.waitForTimeout(400)
  await page.reload()
  const savedCard = page.locator('.task-card').filter({ hasText: 'Автозаполнение реквизитов' })
  await expect(savedCard.getByLabel(/звезда, реакций:/)).toBeVisible()
})

test('инспектор редактирует оценку и закрывается по Escape', async ({ page }) => {
  await page.getByRole('button', { name: 'Бэклог', exact: true }).click()
  await page.getByRole('button', { name: 'Подсказки в форме, если банк не находится', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: /Задача:/ })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Оценка', exact: true }).click()
  await dialog.locator('input[type="range"]').first().fill('2')
  await expect(dialog.locator('.score-control output').first()).toHaveText('2')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('идея быстро добавляется во входящие', async ({ page }) => {
  await page.getByRole('button', { name: 'Входящие', exact: true }).click()
  await page.getByLabel('Название идеи').fill('Проверить новый сценарий')
  const author = page.getByRole('combobox', { name: 'Кто добавляет на разбор' })
  await expect(author).toContainText('Не указано')
  await expect(author).toHaveAttribute('aria-expanded', 'false')
  await author.click()
  await expect(author).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(author).toHaveAttribute('aria-expanded', 'false')
  await author.click()
  await page.getByRole('option', { name: 'Ваня', exact: true }).click()
  await expect(author).toContainText('Ваня')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  const ideaRow = page.locator('.inbox-list > li').filter({ hasText: 'Проверить новый сценарий' })
  await expect(ideaRow.getByRole('button', { name: 'Проверить новый сценарий', exact: true })).toBeVisible()
  await expect(ideaRow.locator('.author-meta')).toContainText('Добавил Ваня')
  await page.waitForTimeout(400)

  const saved = await page.request.get('/api/state').then((response) => response.json())
  const idea = saved.items.find(
    (item: { title: string }) => item.title === 'Проверить новый сценарий',
  )
  expect(idea.authorId).toBe('m2')
})

test('задача от агента помечена на карточке и в инспекторе', async ({ page }) => {
  const state = await page.request.get('/api/state').then((response) => response.json())
  const item = state.items.find(
    (candidate: { title: string }) => candidate.title === 'Автозаполнение реквизитов в онбординге',
  )
  item.createdVia = 'agent'
  const saved = await page.request.put('/api/state', { data: state })
  expect(saved.ok()).toBeTruthy()

  await page.reload()
  const card = page.locator('.task-card').filter({ hasText: item.title })
  await expect(card.getByLabel('Задача создана через AI-агента')).toBeVisible()

  await card.getByRole('button', { name: item.title, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Задача: ${item.title}` })
  await expect(dialog.getByLabel('Задача создана через AI-агента')).toBeVisible()

  const regularCard = page.locator('.task-card').filter({ hasText: 'Проверка шагов онбординга' })
  await expect(regularCard.getByLabel('Задача создана через AI-агента')).toHaveCount(0)
})

test('роли меняются только после подтверждения и сохраняются у недели', async ({ page }) => {
  await page.getByRole('button', { name: 'Команда', exact: true }).click()
  await expect(page.getByText('Выбрать себя')).toHaveCount(0)
  await expect(page.getByText('Роль недели', { exact: true })).toHaveCount(0)

  const columnsAreCentered = await page.locator('.member-fields').first().evaluate((fields) => {
    if (window.innerWidth < 768) return true
    const [name, role] = Array.from(fields.children)
    if (!name || !role) return false
    const nameBox = name.getBoundingClientRect()
    const roleBox = role.getBoundingClientRect()
    const nameCenter = nameBox.top + nameBox.height / 2
    const roleCenter = roleBox.top + roleBox.height / 2
    return Math.abs(nameCenter - roleCenter) < 1
  })
  expect(columnsAreCentered).toBeTruthy()

  await page.locator('main').getByRole('button', { name: 'Перемешать роли…', exact: true }).click()
  const confirmation = page.getByRole('alertdialog', { name: 'Перемешать роли?' })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Оставить как есть' }).click()
  await expect(confirmation).toBeHidden()

  let saved = await page.request.get('/api/state').then((response) => response.json())
  expect(saved.sprints.some((sprint: { roles?: Record<string, string> }) => sprint.roles)).toBeFalsy()

  await page.locator('main').getByRole('button', { name: 'Перемешать роли…', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Перемешать', exact: true }).click()
  await page.waitForTimeout(400)

  saved = await page.request.get('/api/state').then((response) => response.json())
  const weeklyRoles = saved.sprints.find(
    (sprint: { id: string; roles?: Record<string, string> }) =>
      sprint.id === saved.sprints[0].id,
  )?.roles
  expect(Object.keys(weeklyRoles ?? {})).toHaveLength(saved.members.length)
})
