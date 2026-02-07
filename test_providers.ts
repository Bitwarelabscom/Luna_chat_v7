import { fetchAllModels } from './src/llm/model-fetcher.service.js';
import { PROVIDERS } from './src/llm/types.js';

async function test() {
  console.log('Static providers count:', PROVIDERS.length);
  const liveProviders = await fetchAllModels();
  console.log('Live providers count:', liveProviders.length);
  liveProviders.forEach(p => {
    console.log(`- ${p.id}: ${p.models.length} models`);
  });
}

test().catch(console.error);
