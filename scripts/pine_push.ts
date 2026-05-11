#!/usr/bin/env node
import { readFileSync } from 'fs';
import { setSource, compile, getErrors } from '../src/core/pine.js';
import { disconnect } from '../src/connection.js';

async function main() {
  const srcPath = new URL('./current.pine', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
  const src = readFileSync(srcPath, 'utf-8');

  await setSource({ source: src });
  console.log(`Pushed ${src.split('\n').length} lines → Pine editor`);

  const compileResult = await compile();
  console.log('Compile:', compileResult.button_clicked);

  await new Promise(r => setTimeout(r, 3000));
  const { errors } = await getErrors();

  if (errors.length === 0) {
    console.log('✅ Compiled clean — 0 errors');
  } else {
    console.log(`❌ ${errors.length} errors:`);
    errors.forEach(e => console.log(`  Line ${e.line}: ${e.message || e.msg}`));
  }
  await disconnect();
}

main().catch(err => {
  console.error(`pine_push failed: ${err.message}`);
  process.exit(1);
});
