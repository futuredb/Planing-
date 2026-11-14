import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, expect } from '@playwright/test'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const dir=path.join(root,'output/share')
// Capture the exact offline interface linked from the presentation, with no live service.
const browser=await chromium.launch()
const context=await browser.newContext({viewport:{width:1440,height:1050},offline:true})
const page=await context.newPage()
async function capture(view, name) {
  await expect(page.locator('.nav-item[aria-current="page"]').first()).toHaveText(view)
  // Wait for finite entrance transitions; the pearl button animation runs forever.
  await page.evaluate(async () => {
    const animations = document.getAnimations().filter(animation =>
      Number.isFinite(animation.effect?.getComputedTiming().endTime))
    await Promise.all(animations.map(animation => animation.finished.catch(() => {})))
  })
  await expect(page.locator('#main-content')).toHaveCSS('opacity', '1')
  await page.screenshot({path:path.join(dir, `preview-${name}.png`), animations:'disabled'})
}
await page.goto(pathToFileURL(path.join(dir,'Funban-interactive.html')).href)
await page.getByRole('button',{name:'Бэклог',exact:true}).first().click()
await expect(page.locator('.matrix-card')).toHaveCount(50)
await expect(page.locator('.matrix-card').filter({hasText:'AI-native инструменты дизайнера'}).locator('.ai-score-button')).toHaveText('6')
await capture('Бэклог', 'backlog')
await page.getByRole('button',{name:'Входящие',exact:true}).first().click()
await expect(page.locator('.inbox-list > li')).toHaveCount(2)
if(await page.locator('dialog[open]').count())throw Error('Inbox must be captured without a modal')
await expect(page.locator('.inbox-list > li').filter({hasText:'Автоматизировать сбор материалов'}).locator('.ai-score-button')).toHaveText('7')
await capture('Входящие', 'inbox')
await page.locator('.inbox-list > li').filter({hasText:'Автоматизировать сбор материалов'}).locator('.ai-score-button').click()
await expect(page.getByRole('dialog').getByLabel('Оценка приоритета')).toHaveValue('7')
await capture('Входящие', 'recommendation')
await browser.close()
let story=fs.readFileSync(path.join(dir,'Funban-presentation.html'),'utf8')
let imageIndex=0
const images=['backlog','inbox','recommendation']
story=story.replace(/src="data:image\/png;base64,[^"]+"/g,()=>`src="data:image/png;base64,${fs.readFileSync(path.join(dir,'preview-'+images[imageIndex++]+'.png')).toString('base64')}"`)
if(imageIndex!==3)throw Error('Unexpected presentation images')
story=story.replace(/href="Funban-interactive.html" target="_blank" rel="noopener noreferrer"/g,'href="#demo" data-demo="backlog"')
story=story.replace('<main>','<main id="presentation">')
story=story.replace('Скриншоты локальной версии. В этом файле можно раскрывать пояснения и примеры; работа с карточками и запуск ИИ доступны в самом приложении.','В демоверсии — 50 задач бэклога и 2 входящие из локального показа. Открывайте карточки, подтверждайте баллы и проверяйте отсчёт дней. Рекомендации сохранены заранее; новых ИИ-запусков нет.')
story=story.replace('<details open><summary>Открытая рекомендация','<details><summary>Открытая рекомендация')
story=story.replace('<summary>Входящие</summary>','<summary>Входящие</summary><a class="button" href="#demo" data-demo="inbox">Попробовать во входящих →</a>')
story=story.replace(/<footer>[\s\S]*?<\/footer>/,'<footer>Автономный показ для команды · 14 ноября 2026. Презентация и кликабельный Funban находятся в одном файле. Изменения действуют только в демо; сервер и ИИ-запуски не используются. Для перехода к внешним источникам нужен интернет.</footer>')
const app=fs.readFileSync(path.join(dir,'Funban-interactive.html'),'utf8')
const embedded=JSON.stringify(app).replace(/</g,'\\u003c')
const shell=`<style>[hidden]{display:none!important}#demo-shell{position:fixed;inset:0;background:#f3f4f1;z-index:20;display:flex;flex-direction:column}#demo-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 18px;border-bottom:1px solid #dce1dc;background:white;min-height:52px;font:14px Arial,sans-serif}#demo-back{border:1px solid #dce1dc;border-radius:10px;background:white;color:#2563eb;padding:9px 14px;font:600 14px Arial,sans-serif;cursor:pointer}#demo-back:focus-visible{outline:3px solid #97b5ff}#demo-frame{width:100%;flex:1;min-height:0;border:0}body.show-demo{overflow:hidden}@media(max-width:600px){#demo-bar span{font-size:12px}}</style>
<div id="demo-shell" hidden><div id="demo-bar"><button id="demo-back">← К презентации</button><span>Funban · офлайн-демо</span></div><iframe id="demo-frame" title="Кликабельная демоверсия Funban"></iframe></div>
<script id="demo-document" type="application/json">${embedded}</script>
<script>
const shell=document.getElementById('demo-shell'),frame=document.getElementById('demo-frame'),presentation=document.getElementById('presentation');let ready=false,view='backlog',trigger=null,position=0;
function navigate(){const d=frame.contentDocument;if(!d)return;const name=view==='inbox'?'Входящие':'Бэклог';const button=[...d.querySelectorAll('.nav-item')].find(b=>b.textContent.trim()===name);if(!button)return false;d.querySelectorAll('dialog[open]').forEach(x=>x.close());button.click();frame.contentWindow.scrollTo(0,0);return true}
frame.addEventListener('load',()=>{ready=true;if(navigate())return;const observer=new MutationObserver(()=>{if(navigate())observer.disconnect()});observer.observe(frame.contentDocument.body,{childList:true,subtree:true})});
document.addEventListener('click',e=>{const link=e.target.closest('[data-demo]');if(!link)return;e.preventDefault();trigger=link;position=scrollY;view=link.dataset.demo;shell.hidden=false;presentation.hidden=true;document.body.classList.add('show-demo');if(!frame.hasAttribute('srcdoc'))frame.srcdoc=JSON.parse(document.getElementById('demo-document').textContent);else if(ready)navigate();document.getElementById('demo-back').focus()});
document.getElementById('demo-back').onclick=()=>{shell.hidden=true;presentation.hidden=false;document.body.classList.remove('show-demo');window.scrollTo(0,position);trigger?.focus({preventScroll:true})};
</script>`
story=story.replace('</html>',()=>shell+'</html>')
fs.writeFileSync(path.join(dir,'Funban-for-lead.html'),story)
fs.writeFileSync(path.join(dir,'Как открыть.txt'),'Откройте Funban-for-lead.html в Chrome, Edge или Safari.\nСначала появится презентация. Кнопка «Открыть демоверсию Funban» переключает на кликабельную доску; «К презентации» возвращает к обзору.\nВсе части встроены в один файл. Сервер и ИИ-запуски не нужны.\nВ демо: 50 задач бэклога, 2 входящие, сохранённые рекомендации и демонстрационный отсчёт дней. Балл ИИ хранится отдельно от подтверждённого.\nИзменения сохраняются только в браузере получателя.\nЕсли мессенджер показывает лишь предпросмотр, сначала скачайте файл и откройте его браузером.\n')
console.log('Packaged presentation-first file with embedded demo and fresh screenshots.')
