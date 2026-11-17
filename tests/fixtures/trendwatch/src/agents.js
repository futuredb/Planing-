/** Deterministic test model. No provider SDKs and no network. */
export class AgentTeam {
  configuration={}
  role(){return {json:async(_prompt,input,_tokens,validate)=>{
    const result={potential:'medium',confidence:'weak',summary:'Тестовая рекомендация: проверить пользу для команды.',timing:'Сначала ограниченный пилот.',nextStep:'Сравнить два обзора и проверить ссылки.',
      reasons:[{text:'В тестовом источнике есть пример применения.',evidenceIds:['e1']}],limitations:['Синтетические данные теста; эффект для команды не измерен.'],
      scores:input.criteria.map(c=>({criterionId:c.id,value:c.invert?null:Math.floor(c.max/c.step*.7)*c.step,reason:c.invert?'Оценивает человек.':'Предложение тестовой модели.'})),matrixBucket:'research-next'}
    validate(result);return result
  }}}
}
