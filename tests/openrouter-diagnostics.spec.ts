import { test, expect } from '@playwright/test'
import { createSeed } from '../src/seed'

test('AI failure details remain readable without replacing the saved score', async ({ page }, info) => {
  const seed = createSeed()
  const item = { ...seed.items[0], id: 'diagnostic-task', title: 'Проверка диагностики', body: 'Синтетическая задача.', lane: 'backlog' as const,
    matrixBucket: 'research-next' as const, priorityScore: 4, parentId: null, sprintId: null, relatedIds: [], attachments: [], stickers: [] }
  seed.items = [item]; seed.comments = []
  await page.request.post('/__test/reset', { data: seed })
  await page.route('**/api/items/diagnostic-task/trendwatch', route => route.fulfill({ json: {
    available: true, mode: 'openrouter', automatic: false, configurationMessage: null,
    job: { id: '11111111-1111-4111-8111-111111111111', itemId: item.id, mode: 'openrouter', status: 'failed', stage: 'prioritizing',
      createdAt: Date.now(), stale: false, snapshot: { ...item, criteria: seed.criteria }, recommendation: null, evidence: [], decision: null,
      message: 'Модель не завершила ответ. Сохранённая оценка не изменена.',
      failure: { code: 'OPENROUTER_INCOMPLETE', phase: 'response', elapsedMs: 18000, responseStatus: 'incomplete', incompleteReason: 'max_output_tokens', outputTokens: 4096 },
    },
  } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Бэклог', exact: true }).click()
  await page.locator('.ai-score-button').click()
  const dialog = page.getByRole('dialog', { name: 'Рекомендация ИИ', exact: true })
  await expect(dialog).toContainText('Сохранённая оценка не изменена.')
  await dialog.getByText('Детали ошибки', { exact: true }).click()
  await expect(dialog).toContainText('OPENROUTER_INCOMPLETE')
  await expect(dialog).toContainText('Достигнут лимит выходных токенов')
  await expect(dialog).toContainText('Длительность: 18 сек.')
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `output/playwright/openrouter-diagnostics-${info.project.name}.png` })
  expect((await (await page.request.get('/api/state')).json()).items[0].priorityScore).toBe(4)
})
