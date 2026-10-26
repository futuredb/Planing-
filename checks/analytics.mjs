// Invoked by the isolated Codex preview check runner, never against the live board.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createStateRepository } from '../state-repository.mjs'
import { committedActions } from '../activity.mjs'

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'funban-analytics-'))
const actions = []
try {
  const repository = createStateRepository(path.join(directory, 'state.json'), {
    onChange(previous, next) { actions.push(...committedActions(previous, next)) },
  })
  let { state } = await repository.replace(JSON.stringify({ items: [], comments: [], sprints: [], updatedAt: 0 }), 0)
  await repository.read()
  await repository.readIfVersion(state.updatedAt)
  state = (await repository.replace(JSON.stringify({...state, currentMemberId:'new-member'}), state.updatedAt)).state
  assert.deepEqual(actions, [], 'Reads, initial import and selection must not count')
  const create = next => ({ state: {...next, items:[{id:'one',title:'Private title',lane:'todo',sprintId:null}]}, touchedIds:['one'],result:{} })
  await repository.mutate({action:'create_task',requestId:'once'},create)
  await repository.mutate({action:'create_task',requestId:'once'},create)
  assert.deepEqual(actions,['funban.task.created'], 'MCP retries must not count twice')
  state = await repository.read()
  await repository.replace(JSON.stringify(state),state.updatedAt)
  assert.equal(actions.length,1,'Autosave with no changes must not count')
  await assert.rejects(repository.replace(JSON.stringify(state),0))
  assert.equal(actions.length,1,'Rejected writes must not count')
  state = structuredClone(await repository.read())
  state.items[0].lane = 'done'
  await repository.replace(JSON.stringify(state),state.updatedAt)
  assert.equal(actions.at(-1),'funban.task.moved')
  assert(!JSON.stringify(actions).includes('Private title'))
  const failSafe = createStateRepository(path.join(directory,'state.json'), {onChange(){throw Error('collector offline')}})
  const current = await failSafe.read()
  await failSafe.replace(JSON.stringify({...current,comments:[{id:'comment',text:'private'}]}),current.updatedAt)
  console.log('OK: committed changes, reads, no-op saves, retries, conflicts, collector failure')
} finally {
  await fs.rm(directory,{recursive:true,force:true})
}
