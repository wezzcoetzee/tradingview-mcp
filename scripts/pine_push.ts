#!/usr/bin/env bun
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { setSource, smartCompile } from '../src/core/pine.js';
import { disconnect } from '../src/connection.js';

async function main() {
  const src = readFileSync(fileURLToPath(new URL('./current.pine', import.meta.url)), 'utf-8');

  await setSource({ source: src });
  console.log(`Pushed ${src.split('\n').length} lines → Pine editor`);

  const { button_clicked, errors } = await smartCompile();
  console.log('Compile:', button_clicked);

  if (errors.length === 0) {
    console.log('✅ Compiled clean — 0 errors');
  } else {
    console.log(`❌ ${errors.length} errors:`);
    errors.forEach(e => console.log(`  Line ${e.line}: ${e.message}`));
  }
  await disconnect();
}

main().catch(err => {
  console.error(`pine_push failed: ${err.message}`);
  process.exit(1);
});
