import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assess} from '../src/reaction';
test('Five reactions separate adequate progress, clarification, hurt, anger and unrelated topics',()=>{
 const base={outcome:'correct' as const,confidence:.95,native:false,emotion:'neutral' as const,reason:'상황에 맞는 설명'};
 assert.equal(assess({...base,reaction:'happy',goalAchieved:false}).progression,'advance');
 const soso=assess({...base,reaction:'neutral',goalAchieved:true});assert.equal(soso.mark,'△');assert.equal(soso.outcome,'correct');assert.equal(soso.progression,'advance');
 assert.equal(assess({...base,reaction:'neutral',goalAchieved:false}).progression,'retry');
 for(const reaction of ['angry','sad'] as const)assert.equal(assess({...base,reaction}).outcome,'misunderstanding');
 const unrelated=assess({...base,reaction:'confused',goalAchieved:true});assert.equal(unrelated.outcome,'clarify');assert.equal(unrelated.goalAchieved,false);
 for(const grade of [{...base,reaction:'angry' as const,confidence:.3},{...base,reaction:'sad' as const,native:true}]){const result=assess(grade);assert.equal(result.reaction,'neutral');assert.equal(result.outcome,'clarify');}
});
