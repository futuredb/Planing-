import {test,expect} from '@playwright/test'
import {createSeed} from '../src/seed'

test('ввод и добавление не запускают уточнение или оценку даже с прежним AUTO=1',async({page})=>{
 await page.request.post('/__test/reset',{data:createSeed()})
 await page.request.post('/__test/research-mode',{data:{mode:'codex',automatic:true,web:true}})
 const requests:string[]=[]
 page.on('request',request=>{if(request.method()==='POST'&&/\/api\/(inbox\/clarify|items\/[^/]+\/trendwatch)$/.test(new URL(request.url()).pathname))requests.push(request.url())})
 await page.goto('/');await page.getByRole('button',{name:'Входящие',exact:true}).click()
 const title='Неоднозначные цифровые дизайны',body='Цель бизнеса — продавать больше дизайнов. Нужно выбрать предложение.'
 await page.getByLabel('Название идеи').fill(title);await page.getByLabel('Контекст идеи').fill(body)
 await page.waitForTimeout(1000) // Past the old 400 ms debounce.
 await expect(page.getByLabel('Необязательное уточнение')).toHaveCount(0)
 await page.getByRole('button',{name:'Добавить',exact:true}).click()
 const row=page.locator('.inbox-list > li').filter({has:page.getByRole('button',{name:title,exact:true})})
 await expect(row.locator('.ai-score-button')).toHaveText('—')
 await expect.poll(async()=>{const state=await(await page.request.get('/api/state')).json();return state.items.some((i:{title:string})=>i.title===title)}).toBe(true)
 const state=await(await page.request.get('/api/state')).json(),item=state.items.find((i:{title:string})=>i.title===title)
 expect(item.body).toBe(body);expect(item.priorityScore).toBeUndefined()
 const status=await(await page.request.get(`/api/items/${item.id}/trendwatch`)).json()
 expect(status.automatic).toBe(false);expect(status.job).toBeNull()
 await page.reload();await page.getByRole('button',{name:'Входящие',exact:true}).click()
 await expect(row.locator('.ai-score-button')).toHaveText('—')
 expect(requests).toEqual([])
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
