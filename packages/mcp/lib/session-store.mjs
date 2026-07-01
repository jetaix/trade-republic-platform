/**
 * Persist the Trade Republic session (cookie jar + WAF token) to disk so the
 * MCP survives restarts without re-doing the browser login. Stored at
 * ~/.trade-republic-mcp/session.json with 0600 perms (owner read/write only).
 *
 * Override the directory with TR_MCP_HOME.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DIR = process.env.TR_MCP_HOME || join(homedir(), '.trade-republic-mcp');
export const SESSION_PATH = join(DIR, 'session.json');

export function saveSession(data) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(SESSION_PATH, JSON.stringify({ ...data, savedAt: Date.now() }), { mode: 0o600 });
  try {
    chmodSync(SESSION_PATH, 0o600);
  } catch {}
}

export function loadSession() {
  if (!existsSync(SESSION_PATH)) return null;
  try {
    return JSON.parse(readFileSync(SESSION_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export function clearSession() {
  if (existsSync(SESSION_PATH)) rmSync(SESSION_PATH);
}
