import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'web');
const output = join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });

const config = {
  supabaseUrl: process.env.SUPABASE_URL?.trim().replace(/\/$/, '') || '',
  publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || '',
};
if (Boolean(config.supabaseUrl) !== Boolean(config.publishableKey)) {
  throw new Error('Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY juntas');
}
if (process.env.VERCEL && !config.supabaseUrl) {
  throw new Error('Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY na Vercel antes de publicar');
}
if (config.supabaseUrl && !/^https:\/\//.test(config.supabaseUrl)) {
  throw new Error('SUPABASE_URL deve ser HTTPS');
}
await writeFile(
  join(output, 'config.js'),
  `window.APP_CONFIG = ${JSON.stringify(config)};\n`,
  'utf8',
);
console.log(`Interface preparada em ${output} (${config.supabaseUrl ? 'Supabase' : 'prévia histórica local'}).`);
