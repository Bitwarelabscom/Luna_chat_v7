import { fetchAllModels } from './src/llm/model-fetcher.service.js';
import { config } from './src/config/index.js';

async function test() {
  console.log('Ollama Tertiary Config:', config.ollamaTertiary);
  console.log('Fetching models...');
  try {
    const providers = await fetchAllModels();
    console.log('Providers found:', providers.map(p => p.id));
    const ollamaProviders = providers.filter(p => p.id.startsWith('ollama'));
    console.log('Ollama Providers:', ollamaProviders.map(p => ({ id: p.id, name: p.name, modelCount: p.models.length })));
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
