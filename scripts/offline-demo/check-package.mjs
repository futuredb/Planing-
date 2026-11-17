import {chromium,expect} from '@playwright/test'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),dir=path.join(root,'output/share')
const browser=await chromium.launch(),context=await browser.newContext({offline:true,viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[],requests=[]
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url())})
const navigate=async(d,name)=>d.getByRole('button',{name,exact:true}).first().click()
try{
 await page.goto(pathToFileURL(path.join(dir,'Funban-for-lead.html')).href)
 await expect(page.locator('#presentation')).toBeVisible();await expect(page.locator('#demo-shell')).not.toBeVisible()
 await page.locator('[data-demo="backlog"]').first().click()
 const demo=page.frameLocator('#demo-frame')
 await expect(demo.locator('.matrix-card')).toHaveCount(50)
 await expect(demo.locator('.demo-controls,.legend')).toHaveCount(0)
 for(const [title,days]of [['Демо · Осталось 5 дней','5 дн.'],['Демо · Пора пересмотреть','9 дн.'],['Демо · Срок ожидания истёк','0 дн.']])await expect(demo.locator('.matrix-card').filter({hasText:title}).locator('.priority-review-countdown')).toHaveText(days)
 const rows=await demo.locator('.matrix-unassigned .matrix-card').evaluateAll(es=>es.slice(0,3).map(e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,bottom:r.bottom}}))
 if(rows.some((r,i)=>i&&(r.left!==rows[0].left||r.width!==rows[0].width||r.top<rows[i-1].bottom)))throw Error('Unreviewed must be a list')
 for(const [title,score]of [['AI-native инструменты дизайнера',6],['AI исследователь',6],['Генеративные анимации: примерять',6],['Попробовать объединить масскота',5]]){
  const card=demo.locator('.matrix-card').filter({hasText:title});await expect(card.locator('.ai-score-button')).toHaveText(String(score));await card.locator('.ai-score-button').click()
  const dialog=demo.getByRole('dialog');await dialog.locator('details > summary').first().click();await expect(dialog).toContainText('Почему '+score+' из 10');await expect(dialog.getByRole('button',{name:'Повторить анализ',exact:true})).toBeDisabled()
  await dialog.getByRole('button',{name:'Закрыть рекомендацию',exact:true}).click()
 }
 await navigate(demo,'Входящие');await expect(demo.locator('.inbox-list > li')).toHaveCount(2)
 const incoming=demo.locator('.inbox-list > li').filter({hasText:'Автоматизировать сбор материалов'})
 await expect(incoming.locator('.ai-score-button')).toHaveText('7');await incoming.locator('.ai-score-button').click()
 const dialog=demo.getByRole('dialog');await expect(dialog.getByRole('button',{name:'Повторить анализ',exact:true})).toBeDisabled()
 await expect(dialog).toContainText('Офлайн-демо')
 await dialog.getByLabel('Оценка приоритета').fill('11');await expect(dialog.getByRole('button',{name:'Подтвердить',exact:true})).toBeDisabled()
 await dialog.getByLabel('Оценка приоритета').fill('9');await dialog.getByRole('button',{name:'Подтвердить',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(demo.locator('.inbox-list > li')).toHaveCount(1)
 await navigate(demo,'Бэклог');const confirmed=demo.locator('.matrix-card').filter({hasText:'Автоматизировать сбор материалов'});await expect(confirmed.locator('.matrix-score')).toHaveText('9');await expect(confirmed.locator('.ai-score-button')).toHaveText('7')
 await expect(confirmed.locator('.priority-review-countdown')).toHaveText('30 дн.')
 // Drag uses the real matrix drag-and-drop handler.
 const pipeline=demo.locator('.matrix-card').filter({hasText:'AI-native инструменты дизайнера'})
 await pipeline.dragTo(demo.locator('.matrix-quadrant.need-clarify'));await expect(demo.locator('.matrix-quadrant.need-clarify')).toContainText('AI-native инструменты дизайнера')
 await navigate(demo,'Список');await expect(demo.locator('.backlog-table')).toBeVisible();await navigate(demo,'Матрица')
 await page.locator('#demo-back').click();await expect(page.locator('#presentation')).toBeVisible();await page.locator('[data-demo="backlog"]').first().click();await expect(confirmed.locator('.matrix-score')).toHaveText('9')
 await page.reload();await page.locator('[data-demo="backlog"]').first().click();await expect(confirmed.locator('.matrix-score')).toHaveText('9');await expect(confirmed.locator('.ai-score-button')).toHaveText('7')
 await page.setViewportSize({width:390,height:844});await expect(demo.locator('.mobile-nav')).toBeVisible();if(await demo.locator('html').evaluate(el=>el.scrollWidth>innerWidth))throw Error('Mobile overflow')
 await page.screenshot({path:path.join(dir,'component-package-mobile.png')})
 await page.locator('#demo-back').click();if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Presentation overflow')
 if(errors.length||requests.length)throw Error(JSON.stringify({errors,requests}))
 console.log('PASS: real components; 50 + 2; list; countdowns; four recommendations; no AI; human 9 / AI 7; close on confirm; drag; list/matrix; presentation navigation; persistence; mobile; zero network requests.')
}finally{await browser.close()}
