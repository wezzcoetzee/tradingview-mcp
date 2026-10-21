import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/create-server.js';
import { INSTRUCTIONS } from '../src/instructions.js';
import { loadSkills, parseSkill } from '../src/skills.js';
import pkg from '../package.json' with { type: 'json' };

async function connect() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([createServer().connect(serverSide), client.connect(clientSide)]);
  return client;
}

describe('server surface', () => {
  it('names every registered tool in the instructions', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const missing = tools.map(t => t.name).filter(name => !INSTRUCTIONS.includes(name));
    assert.deepEqual(missing, []);
  });

  it('reports the package.json version', async () => {
    const client = await connect();
    assert.equal(client.getServerVersion()?.version, pkg.version);
  });

  it('exposes every skill as a prompt carrying its body', async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    const skills = loadSkills();
    assert.deepEqual(prompts.map(p => p.name).sort(), skills.map(s => s.name).sort());
    const first = skills[0];
    const got = await client.getPrompt({ name: first.name });
    assert.equal((got.messages[0].content as { text: string }).text, first.body);
  });

  it('rejects values outside a tool enum without touching the chart', async () => {
    const client = await connect();
    const res = await client.callTool({ name: 'chart_set_type', arguments: { chart_type: 'Sparkles' } });
    assert.equal(res.isError, true);
  });
});

describe('parseSkill', () => {
  it('reads name and description from frontmatter and keeps the body', () => {
    const skill = parseSkill('---\nname: demo\ndescription: Does a thing: well\n---\n\n# Body\n', 'dir');
    assert.deepEqual(skill, { name: 'demo', description: 'Does a thing: well', body: '# Body' });
  });

  it('falls back to the directory name without frontmatter', () => {
    assert.deepEqual(parseSkill('# Just text', 'dir'), { name: 'dir', description: 'dir', body: '# Just text' });
  });
});
