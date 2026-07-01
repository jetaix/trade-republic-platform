/**
 * Minimal stdio JSON-RPC smoke test for the MCP server (DEMO mode).
 * Spawns server.mjs, initializes, lists tools/resources, calls a few tools.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const child = spawn('node', [join(__dirname, 'server.mjs')], {
  env: { ...process.env, TR_DEMO: '1' },
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buf = '';
const pending = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
  }
});

let id = 0;
const send = (method, params) => {
  const myId = ++id;
  return new Promise((resolve) => {
    pending.set(myId, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
  });
};
const notify = (method, params) =>
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');

let failures = 0;
const assert = (cond, label) => {
  console.log((cond ? '  PASS ' : '  FAIL ') + label);
  if (!cond) failures++;
};

const init = await send('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'smoke', version: '0' },
});
console.log('initialize →', init.result?.serverInfo);
assert(init.result?.serverInfo?.name === 'trade-republic', 'server identifies as trade-republic');
notify('notifications/initialized');

const tools = await send('tools/list', {});
const names = tools.result.tools.map((t) => t.name).sort();
console.log('tools →', names.join(', '));
assert(names.length === 7, 'exposes 7 tools');
['tr_authenticate', 'tr_logout', 'tr_status', 'tr_portfolio_chart', 'tr_positions', 'tr_cash', 'tr_timeline'].forEach((n) =>
  assert(names.includes(n), `has ${n}`),
);

const resources = await send('resources/list', {});
console.log('resources →', resources.result.resources.map((r) => r.uri).join(', '));
assert(resources.result.resources.length === 2, 'exposes 2 resources');

const status = await send('tools/call', { name: 'tr_status', arguments: {} });
const statusObj = JSON.parse(status.result.content[0].text);
assert(statusObj.mode === 'demo' && statusObj.loggedIn, 'tr_status returns demo/loggedIn');

const chart = await send('tools/call', { name: 'tr_portfolio_chart', arguments: { range: '5d' } });
const chartObj = JSON.parse(chart.result.content[0].text);
assert(chartObj.rangeType === '5d' && chartObj.aggregates.length === 120, 'tr_portfolio_chart(5d) returns 120 points');

const cash = await send('tools/call', { name: 'tr_cash', arguments: {} });
const cashObj = JSON.parse(cash.result.content[0].text);
assert(cashObj[0]?.currencyId === 'EUR', 'tr_cash returns EUR balance');

const openapi = await send('resources/read', { uri: 'tr://openapi' });
assert(openapi.result.contents[0].text.includes('openapi: 3.1.0'), 'tr://openapi resource returns the spec');

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`);
child.kill();
process.exit(failures ? 1 : 0);
