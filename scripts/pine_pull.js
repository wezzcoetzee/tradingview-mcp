#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { getSource } from '../src/core/pine.js';
import { disconnect } from '../src/connection.js';

async function main() {
  const { source } = await getSource();
  const outPath = new URL('./current.pine', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
  writeFileSync(outPath, source);
  console.log(`Pulled ${source.split('\n').length} lines → scripts/current.pine`);
  await disconnect();
}

main().catch(err => {
  console.error(`pine_pull failed: ${err.message}`);
  process.exit(1);
});
