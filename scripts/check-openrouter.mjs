import { openRouterConfig, openRouterConfigurationMessage, openRouterClarifierConfig } from '../trendwatch-openrouter.mjs'
const message=openRouterConfigurationMessage()
if(message){console.error(message);process.exitCode=1}
else{
 try{
 const {model,maxTokens,timeoutMs,maxKeyLimit}=openRouterConfig()
 const clarification=openRouterClarifierConfig()
 console.log(JSON.stringify({configuration:'valid',model,maxOutputTokens:maxTokens,timeoutSeconds:timeoutMs/1000,maxKeyLimitUSD:maxKeyLimit,
   clarification:{model:clarification.model,maxOutputTokens:clarification.maxTokens,timeoutMs:clarification.timeoutMs,webSearch:false},
   networkRequests:0,note:'Проверены только локальные настройки. Ключ, баланс и совместимость модели проверяются при запуске анализа.'},null,2))
 }catch{console.error('OpenRouter: некорректная модель уточнения. Проверьте FUNBAN_OPENROUTER_CLARIFY_MODEL.');process.exitCode=1}
}
