import {test,expect} from '@playwright/test'
import {createSeed} from '../src/seed'

test('вопрос можно пропустить: описание сохраняется без добавок, приоритет всё равно появляется',async({page})=>{
 await page.goto('about:blank');await page.request.post('/__test/reset',{data:createSeed()})
 await page.request.post('/__test/research-mode',{data:{mode:'codex',automatic:true,web:true}})
 let questions=0;page.on('request',request=>{if(request.url().endsWith('/api/inbox/clarify'))questions++})
 await page.goto('/');await page.getByRole('button',{name:'Входящие',exact:true}).click()
 const title='Неоднозначные цифровые дизайны',body='Цель бизнеса — продавать больше дизайнов. Нужно выбрать предложение.'
 await page.getByLabel('Название идеи').fill(title);await page.getByLabel('Контекст идеи').fill(body)
 await expect(page.getByLabel('Необязательное уточнение')).toBeVisible({timeout:10000})
 await page.getByRole('button',{name:'Пропустить',exact:true}).click()
 await expect(page.getByLabel('Необязательное уточнение')).toHaveCount(0)
 await page.getByRole('button',{name:'Добавить',exact:true}).click()
 const row=page.locator('.inbox-list > li').filter({has:page.getByRole('button',{name:title,exact:true})})
 await expect(row.locator('.ai-score-button')).toHaveText('7',{timeout:10000})
 const state=await(await page.request.get('/api/state')).json(),item=state.items.find((i:{title:string})=>i.title===title)
 expect(item.body).toBe(body);expect(item.priorityScore).toBeUndefined();expect(questions).toBe(1)
})

test('API уточнения проверяет сессию, Origin и входные данные',async({page})=>{
 await page.request.post('/__test/reset',{data:createSeed()})
 const url='/api/inbox/clarify'
 const probe=await(await page.request.get(`/__test/probe?path=${encodeURIComponent(url)}&method=POST`)).json()
 expect(probe.status).toBe(401)
 expect((await page.request.post(url,{headers:{Origin:'https://attacker.invalid'},data:{title:'Некоторая задача',body:''}})).status()).toBe(403)
 expect((await page.request.post(url,{data:{title:'a',body:''}})).status()).toBe(422)
 expect((await page.request.get(url)).status()).toBe(405)
})

test('ввод продолжается во время уточнения: берём свежий контекст, вопрос не прерывает набор',async({page})=>{
 await page.request.post('/__test/reset',{data:createSeed()})
 await page.request.post('/__test/research-mode',{data:{mode:'codex',automatic:true,web:true}})
 const inputs:{title:string;body:string}[]=[]
 await page.route('**/api/inbox/clarify',async route=>{
  inputs.push(route.request().postDataJSON())
  await new Promise(resolve=>setTimeout(resolve,inputs.length===1?600:100))
  await route.fulfill({json:{question:inputs.length===1?'Старый вопрос?':'Какие дизайны продаём?'}})
 })
 await page.goto('/');await page.getByRole('button',{name:'Входящие',exact:true}).click()
 const started=Date.now()
 await page.getByLabel('Название идеи').fill('Исследовать цифровые дизайны')
 await expect.poll(()=>inputs.length).toBe(1)
 await page.getByLabel('Контекст идеи').fill('Хотим продавать больше дизайнов, выбираем предложение.')
 await expect(page.getByLabel('Необязательное уточнение')).toBeVisible({timeout:3000})
 expect(Date.now()-started).toBeLessThan(3000)
 expect(inputs).toHaveLength(2);expect(inputs[1].body).toContain('продавать больше')
 await expect(page.getByText('Старый вопрос?',{exact:true})).toHaveCount(0)
 await expect(page.getByLabel('Контекст идеи')).toBeFocused()
 await page.getByLabel('Контекст идеи').press('End');await page.getByLabel('Контекст идеи').pressSequentially(' Ещё контекст.',{delay:30})
 await expect(page.getByLabel('Необязательное уточнение')).toBeVisible()
 await expect(page.getByRole('button',{name:'Добавить',exact:true})).toBeEnabled()
 await page.getByRole('button',{name:'Пропустить',exact:true}).click()
 await page.getByLabel('Контекст идеи').fill('Новое описание после пропуска')
 await page.waitForTimeout(600);expect(inputs).toHaveLength(2)
})
