#!/usr/bin/env bun
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { getSource } from '../src/core/pine.js';
import { disconnect } from '../src/connection.js';

async function main() {
  const { source } = await getSource();
  writeFileSync(fileURLToPath(new URL('./current.pine', import.meta.url)), source);
  console.log(`Pulled ${source.split('\n').length} lines → scripts/current.pine`);
  await disconnect();
}

main().catch(err => {
  console.error(`pine_pull failed: ${err.message}`);
  process.exit(1);
});
