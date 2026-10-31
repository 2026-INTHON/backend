import {workOne} from '../src/generation';
for(let i=0;i<160;i++){const result=await workOne();console.log(JSON.stringify(result));if(!result.worked)break;}
