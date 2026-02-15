import { promises as fs } from 'fs';
import path from 'path';

const MEDIA_ROOT = '/mnt/data/media';

function normalizeQuery(query: string): string {
  return query.toLowerCase()
    .replace(/episode\s+one\b/g, 'e01')
    .replace(/episode\s+two\b/g, 'e02')
    .replace(/episode\s+three\b/g, 'e03')
    .replace(/episode\s+four\b/g, 'e04')
    .replace(/episode\s+five\b/g, 'e05')
    .replace(/episode\s+(\d+)\b/g, 'e$1')
    .replace(/season\s+(\d+)\b/g, 's$1');
}

async function findFiles(dir: string, query: string = ''): Promise<string[]> {
  let results: string[] = [];
  let list: string[] = [];
  
  try {
    list = await fs.readdir(dir);
  } catch (err) {
    console.error('Failed to read directory', dir, (err as Error).message);
    return [];
  }

  const normalizedQuery = normalizeQuery(query);
  const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 0);
  console.log('Query:', query, 'Normalized:', normalizedQuery, 'Words:', queryWords);

  for (const file of list) {
    const filePath = path.join(dir, file);
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (err) {
      continue;
    }

    if (stat && stat.isDirectory()) {
      results = results.concat(await findFiles(filePath, query));
    } else {
      const ext = path.extname(file).toLowerCase();
      const isMedia = ['.mp4', '.mkv', '.avi', '.mov', '.mp3', '.flac', '.wav', '.m4a'].includes(ext);
      
      if (isMedia) {
        if (!query) {
          results.push(filePath);
        } else {
          const lowerFile = file.toLowerCase();
          const matches = queryWords.every(word => lowerFile.includes(word));
          if (matches) {
            results.push(filePath);
          } else {
              // console.log('No match for', file);
          }
        }
      }
    }
  }

  return results;
}

async function run() {
    console.log('Searching for "Shantaram S01E01"...');
    const r1 = await findFiles(MEDIA_ROOT, 'Shantaram S01E01');
    console.log('Results:', r1);

    console.log('\nSearching for "Shantaram"...');
    const r2 = await findFiles(MEDIA_ROOT, 'Shantaram');
    console.log('Results:', r2);
}

run();
