#!/usr/bin/env node
// Synthetic offline protocol fixture. Never used by the local development board.
import readline from 'node:readline'
console.log(JSON.stringify({ready:true}))
for await(const line of readline.createInterface({input:process.stdin})){
 const input=JSON.parse(line)
 await new Promise(resolve=>setTimeout(resolve,input.title.includes('Медленное уточнение')?60000:100))
 console.log(JSON.stringify({id:input.id,question:input.title.includes('Продукт уже определён')?null:'Какие именно цифровые дизайны вы хотите продавать?'}))
}
