import { readdirSync, readFileSync } from 'fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const SKILLS_DIR = new URL('../skills/', import.meta.url);

export interface Skill {
  name: string;
  description: string;
  body: string;
}

/** Parse a SKILL.md: `name` and `description` from the frontmatter, the rest as the body. */
export function parseSkill(markdown: string, fallbackName: string): Skill {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const [front, body] = match ? [match[1], match[2]] : ['', markdown];
  const field = (key: string) => front.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1].trim();
  return {
    name: field('name') ?? fallbackName,
    description: field('description') ?? fallbackName,
    body: body.trim(),
  };
}

/** One skill per skills/<dir>/SKILL.md. */
export function loadSkills(dir: URL = SKILLS_DIR): Skill[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => parseSkill(readFileSync(new URL(`${entry.name}/SKILL.md`, dir), 'utf8'), entry.name));
}

export function registerSkillPrompts(server: McpServer, skills: Skill[] = loadSkills()) {
  for (const { name, description, body } of skills) {
    server.registerPrompt(name, { description }, () => ({
      messages: [{ role: 'user', content: { type: 'text', text: body } }],
    }));
  }
}
