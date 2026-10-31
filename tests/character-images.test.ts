import {test} from 'node:test';
import assert from 'node:assert/strict';
import {choose} from '../src/character-images';
test('Image selection keeps identity and prefers expression over an unavailable gesture',()=>{
 const items=[{assetKey:'g-neutral',characterId:'girlfriend',emotion:'neutral' as const,gesture:'idle' as const,imageUrl:'/neutral.webp'},
 {assetKey:'g-happy',characterId:'girlfriend',emotion:'happy' as const,gesture:'idle' as const,imageUrl:'/happy.webp'},
 {assetKey:'g-happy-nod',characterId:'girlfriend',emotion:'happy' as const,gesture:'nod' as const,imageUrl:'/nod.webp'},
 {assetKey:'p-angry',characterId:'professor',emotion:'angry' as const,gesture:'idle' as const,imageUrl:'/professor.webp'}];
 assert.equal(choose(items,'girlfriend','happy','nod')?.assetKey,'g-happy-nod');
 assert.equal(choose(items,'girlfriend','happy','open_hand')?.assetKey,'g-happy');
 assert.equal(choose(items,'girlfriend','angry','idle')?.assetKey,'g-neutral');
 assert.equal(choose(items,'friend','angry','idle'),null);
});
