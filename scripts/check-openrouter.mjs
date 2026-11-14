import { openRouterConfig, openRouterConfigurationMessage } from '../trendwatch-openrouter.mjs'
const message=openRouterConfigurationMessage()
if(message){console.error(message);process.exitCode=1}
else{
 const {model,maxTokens,timeoutMs,maxKeyLimit}=openRouterConfig()
 console.log(JSON.stringify({configuration:'valid',model,maxOutputTokens:maxTokens,timeoutSeconds:timeoutMs/1000,maxKeyLimitUSD:maxKeyLimit,
   networkRequests:0,note:'Проверены только локальные настройки. Ключ, баланс и совместимость модели проверяются при запуске анализа.'},null,2))
}
