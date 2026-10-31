import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activeNode} from '../src/game';
import type {Play} from '../src/models';

test('A route override keeps SceneNode fields and never sends its lookup nodeId to the strict AI API',()=>{
 const original={id:'n4',npcText:'원문',goal:'상대 의사 확인',goodExample:'괜찮으세요?',hiddenThought:'의사를 확인하고 싶다.',tip:'물어보세요.',choices:[],nextNodeId:null};
 const play={nodeIndex:3,branchId:'considerate',scenario:{nodes:[original,original,original,original],routes:[{id:'considerate',overrides:[{nodeId:'n4',npcText:'분기 대사',goodExample:'다른 시간은 어떠세요?',hiddenThought:'다른 시간을 원한다.'}]}]}} as unknown as Play;
 const node=activeNode(play);
 assert.equal(node.npcText,'분기 대사');assert.equal(node.id,'n4');
 assert.deepEqual(Object.keys(node).sort(),Object.keys(original).sort());
 assert.equal('nodeId' in node,false);
});
