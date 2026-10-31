import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orderedChapters,type CatalogChapter} from '../src/content';

test('One relationship sequence numbers open and locked chapters without changing IDs or progress',()=>{
 const expected=['gf-1','gf-2','gf-3','fe-example-1','fe-example-2','gf-n','ko-girlfriend','fe-example-4','fe-example-3'];
 const chapters=expected.map((id,i)=>({id,no:i%4,characterId:'girlfriend',title:id,desc:'long old text',pack:'ko',source:'curriculum',locked:i%2===0,subs:[{id:id+'-1',state:'done',score:90}]} as CatalogChapter));
 const result=orderedChapters([...chapters].reverse());
 assert.deepEqual(result.map(x=>x.id),expected);assert.deepEqual(result.map(x=>x.no),[1,2,3,4,5,6,7,8,9]);
 assert.equal(result[3].title,'첫 나들이');assert.ok(result.every(x=>x.desc.length<60));
 for(const chapter of chapters){const updated=result.find(x=>x.id===chapter.id)!;assert.equal(updated.locked,chapter.locked);assert.deepEqual(updated.subs,chapter.subs);}
 const own={...chapters[0],id:'private',no:1,source:'personal'} as CatalogChapter;
 assert.equal(orderedChapters([own,...chapters]).at(-1)!.id,'private');
 const prof={...chapters[0],id:'prof-1',characterId:'professor'} as CatalogChapter;
 assert.equal(orderedChapters([...chapters,prof]).find(c=>c.id==='prof-1')!.no,1);
});
