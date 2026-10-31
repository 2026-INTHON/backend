import {seedCatalog} from '../src/content';
import {enqueueCurriculum} from '../src/generation';
await seedCatalog();
console.log('Catalog seeded: FE PR7 content; user progress was not imported.');
if(process.argv.includes('--generate'))console.log(await enqueueCurriculum());
