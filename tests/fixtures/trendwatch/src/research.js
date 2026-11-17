import { writeFile } from 'node:fs/promises'
import path from 'node:path'
/** Exercises the real worker/IPC/API/UI contract without external calls. */
export async function runResearch(brief,directory,{onStage}) {
  await onStage('collecting')
  await new Promise(resolve=>setTimeout(resolve,brief.answers.topic.includes('Долгое')?60000:700))
  if(brief.answers.topic.includes('Ошибка'))throw new Error('TEST_PROVIDER_FAILURE')
  const run={sections:brief.answers.topic.includes('Мало данных')?[]:[{analysisStatus:'complete',claims:[{text:'Тестовый проверенный вывод',evidenceIds:['e1']}],gaps:[]}],
    sources:[{id:'s1',text:'Синтетическое свидетельство для изолированной проверки.',title:'Тестовый источник',url:'https://example.com/research',retrievedAt:'2026-11-12T00:00:00Z'}],
    evidence:[{id:'e1',sourceId:'s1',quote:'Синтетическое свидетельство для изолированной проверки.',observation:'Тестовое наблюдение.'}],stopReason:'source_budget',stopExplanation:'Тестовый набор источников.'}
  await writeFile(path.join(directory,'report.md'),'# Изолированный тест\nСинтетический отчёт. Реальное исследование не выполнялось.\n')
  await writeFile(path.join(directory,'run.json'),JSON.stringify(run))
  return run
}
