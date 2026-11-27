import { test, expect } from '@playwright/test'
import { createSeed } from '../src/seed'

for (const kind of ['incomplete', 'json', 'schema', 'routing', 'regional']) test(`AI ${kind} failure details remain readable without replacing the saved score`, async ({ page }, info) => {
  const seed = createSeed()
  const item = { ...seed.items[0], id: 'diagnostic-task', title: 'Проверка диагностики', body: 'Синтетическая задача.', lane: 'backlog' as const,
    matrixBucket: 'research-next' as const, priorityScore: 4, parentId: null, sprintId: null, relatedIds: [], attachments: [], stickers: [] }
  seed.items = [item]; seed.comments = []
  await page.request.post('/__test/reset', { data: seed })
  await page.route('**/api/items/diagnostic-task/trendwatch', route => route.fulfill({ json: {
    available: true, mode: 'openrouter', automatic: false, configurationMessage: null,
    job: { id: '11111111-1111-4111-8111-111111111111', itemId: item.id, mode: 'openrouter', status: 'failed', stage: 'prioritizing',
      createdAt: Date.now(), stale: false, snapshot: { ...item, criteria: seed.criteria }, recommendation: null, evidence: [], decision: null,
      message: (kind==='routing'||kind==='regional')?'Ответ модели отклонён проверкой источников, контекста или согласованности оценки. Сохранённая оценка не изменена.':kind==='schema'?'Структура или значения ответа модели не соответствуют формату оценки. Сохранённая оценка не изменена.':kind==='json'?'Ответ модели не удалось прочитать как JSON. Сохранённая оценка не изменена.':'Модель не завершила ответ. Сохранённая оценка не изменена.',
      failure: kind==='regional'?{code:'OPENROUTER_VALIDATION',phase:'validation',validationCode:'INVALID_REGIONAL_EVIDENCE',regionalIssues:['source_not_listed','supported_without_source']}:kind==='routing'?{code:'OPENROUTER_VALIDATION',phase:'validation',validationCode:'INTERNAL_SEARCH_FORBIDDEN',selectedKind:'internal_improvement',assessmentKind:'internal_improvement',searchOutcome:'insufficient',webCalls:0,webQueries:0,sourceCount:0,routingIssues:['outcome_requires_search']}:kind==='schema'?{code:'OPENROUTER_SCHEMA',phase:'schema',answerFormat:'function_call',schemaIssueCount:6,schemaIssues:[0,1,2].flatMap(i=>[{field:`sources.${i}.relevance`,code:'invalid_value'},{field:`sources.${i}`,code:'unrecognized_keys'}])}:kind==='json'?{code:'OPENROUTER_JSON',phase:'parse',elapsedMs:50000,responseStatus:'completed',outputTokens:4740,parseIssue:'invalid_json',reasoningTokens:4000,outputItems:4,assistantMessages:2,textParts:3,answerBytes:10000}:{ code: 'OPENROUTER_INCOMPLETE', phase: 'response', elapsedMs: 18000, responseStatus: 'incomplete', incompleteReason: 'max_output_tokens', outputTokens: 4096 },
    },
  } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Бэклог', exact: true }).click()
  await page.locator('.ai-score-button').click()
  const dialog = page.getByRole('dialog', { name: 'Рекомендация ИИ', exact: true })
  await expect(dialog).toContainText('Сохранённая оценка не изменена.')
  await dialog.getByText('Детали ошибки', { exact: true }).click()
  if(kind==='regional'){
    await expect(dialog).toContainText('Ссылка в выводе о РФ отсутствует среди источников ответа')
    await expect(dialog).toContainText('Применимость к РФ объявлена подтверждённой, но источник не указан')
  }else if(kind==='routing'){
    await expect(dialog).toContainText('Выбранный режим: Внутреннее улучшение')
    await expect(dialog).toContainText('Тип задачи по ответу модели: Внутреннее улучшение')
    await expect(dialog).toContainText('Поисковых запросов по данным провайдера: 0')
    await expect(dialog).toContainText('Модель указала результат поиска вместо «Поиск не нужен»')
  }else if(kind==='json'){
    await expect(dialog).toContainText('OPENROUTER_JSON')
    await expect(dialog).toContainText('Разбор: Ошибка синтаксиса JSON')
    await expect(dialog).toContainText('Токенов рассуждения: 4000')
    await expect(dialog).toContainText('Размер итогового текста: 10000 байт')
  }else if(kind==='schema'){
    await expect(dialog).toContainText('OPENROUTER_SCHEMA')
    await expect(dialog).toContainText('Формат итога: Структурированный результат')
    await expect(dialog).toContainText('Нарушений формата: 6')
    await expect(dialog).toContainText('sources.2.relevance: Значение не входит в допустимый список')
    await expect(dialog).toContainText('sources.2: Лишние поля')
  }else{
    await expect(dialog).toContainText('OPENROUTER_INCOMPLETE')
    await expect(dialog).toContainText('Достигнут лимит выходных токенов')
    await expect(dialog).toContainText('Длительность: 18 сек.')
  }
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `output/playwright/openrouter-diagnostics-${kind}-${info.project.name}.png` })
  expect((await (await page.request.get('/api/state')).json()).items[0].priorityScore).toBe(4)
})
