import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildInfo = path.join(root, 'release/latest-build.json');
const executable = process.env.NAIWA_EXE || (existsSync(buildInfo) ? JSON.parse(readFileSync(buildInfo, 'utf8')).executable : null);

async function withTimeout(promise, message, ms = 8000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { clearTimeout(timer); }
}

function launch(file, args) {
  const child = spawn(file, ['--headless', '--no-browser', ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const result = { child, stdout: '', stderr: '' };
  child.stdout.on('data', data => { result.stdout += data.toString('utf8'); });
  child.stderr.on('data', data => { result.stderr += data.toString('utf8'); });
  child.stdin.on('error', () => {});
  result.done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return result;
}

async function ready(process) {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if (process.stdout.includes('NAIWA_READY ')) return;
    if (process.child.exitCode !== null) throw new Error(`Launcher failed: ${process.stderr}`);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`No ready signal: ${process.stdout} ${process.stderr}`);
}

async function stop(process) {
  if (process.child.exitCode === null && !process.child.killed) process.child.stdin.write('exit\n');
  try { return await withTimeout(process.done, 'Launcher did not stop', 4000); }
  catch (error) { process.child.kill(); await process.done; throw error; }
}

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  return server.address().port;
}

async function close(server) { await new Promise(resolve => server.close(resolve)); }
async function unusedPort() { const server = net.createServer(); const port = await listen(server); await close(server); return port; }

function request(port, target = '/', { method = 'GET', host = `127.0.0.1:${port}`, extraHeaders = '' } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    const chunks = [];
    socket.setTimeout(6000, () => socket.destroy(new Error('HTTP timeout')));
    socket.on('error', error => { error.message = `${target.slice(0, 80)} (${target.length} characters): ${error.message}`; reject(error); });
    socket.on('data', chunk => chunks.push(chunk));
    socket.on('connect', () => socket.write(`${method} ${target} HTTP/1.1\r\nHost: ${host}\r\n${extraHeaders}Connection: close\r\n\r\n`));
    socket.on('end', () => {
      const all = Buffer.concat(chunks);
      const index = all.indexOf('\r\n\r\n');
      if (index < 0) { reject(new Error(`Invalid HTTP response (${all.length} bytes)`)); return; }
      const lines = all.subarray(0, index).toString('ascii').split('\r\n');
      const headers = Object.fromEntries(lines.slice(1).map(line => { const i = line.indexOf(':'); return [line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()]; }));
      resolve({ status: Number(lines[0].split(' ')[1]), headers, body: all.subarray(index + 4) });
    });
  });
}

test('Windows portable launcher serves the actual package safely and exits cleanly', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  assert.ok(executable && existsSync(executable), 'Run pnpm package:windows first, or set NAIWA_EXE to the packaged executable.');
  const port = await unusedPort();
  const app = launch(executable, ['--port', String(port)]);
  t.after(() => stop(app));
  await ready(app);

  await t.test('HTML, build bundles, mascot and all five sounds have correct HTTP responses', async () => {
    const index = await request(port);
    assert.equal(index.status, 200);
    assert.match(index.headers['content-type'], /text\/html/);
    assert.equal(Number(index.headers['content-length']), index.body.length);
    assert.equal(index.headers['x-content-type-options'], 'nosniff');
    const html = index.body.toString('utf8');
    const scripts = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+\.(?:js|css))"/g)].map(match => match[1]);
    assert.ok(scripts.some(file => file.endsWith('.js')) && scripts.some(file => file.endsWith('.css')));
    for (const file of scripts) {
      const response = await request(port, file);
      assert.equal(response.status, 200, file);
      assert.match(response.headers['content-type'], file.endsWith('.js') ? /javascript/ : /text\/css/);
      assert.equal(Number(response.headers['content-length']), response.body.length);
    }
    for (const name of ['nailong_laugh', 'hola_ganbadie', 'gajiaosai', 'gagadilashui', 'dupu']) {
      const response = await request(port, `/audio/${name}.mp3`);
      assert.equal(response.status, 200, name);
      assert.equal(response.headers['content-type'], 'audio/mpeg');
      assert.ok(response.body.length > 1000);
    }
    assert.equal((await request(port, '/assets/naiwa.png')).headers['content-type'], 'image/png');
    const head = await request(port, '/', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(head.headers['content-length'], index.headers['content-length']);
    assert.deepEqual((await request(port, '/?theme=yellow')).body, index.body);
  });

  await t.test('rejects mutation requests, external hosts and duplicate Host headers', async () => {
    const post = await request(port, '/', { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, 'GET, HEAD');
    assert.equal((await request(port, '/', { host: `evil.example:${port}` })).status, 403);
    assert.equal((await request(port, '/', { extraHeaders: `Host: localhost:${port}\r\n` })).status, 400);
  });

  await t.test('blocks traversal, encoded traversal, Windows device paths and malformed encodings', async () => {
    for (const target of ['/../LICENSE', '/%2e%2e/LICENSE', '/audio/../../LICENSE', '/audio/%2e%2e/%2e%2e/LICENSE', '/..%5cLICENSE', '/%252e%252e/LICENSE', '//etc/passwd', '/C:/Windows/win.ini', '/CON', '/audio/../index.html', '/index.html.', '/%00', '/%', '/%GG', '/%C0%AF', '/%E4%B8']) {
      const response = await request(port, target);
      assert.ok([400, 403].includes(response.status), `${target}: ${response.status}`);
    }
    for (const target of ['/LICENSE', '/desktop/NaiwaLauncher.cs', '/audio']) assert.equal((await request(port, target)).status, 404, target);
    assert.equal((await request(port, '/audio/')).status, 403);
    // Closing an oversized request with unread bytes may reset TCP on Windows.
    try { assert.equal((await request(port, '/' + 'x'.repeat(17000))).status, 400); }
    catch (error) { assert.equal(error.code, 'ECONNRESET', 'oversized headers must be rejected or closed'); }
    assert.equal((await request(port)).status, 200, 'invalid requests must not crash the server');
  });

  await t.test('a second launch of the same copy reuses its server without leaving a process', async () => {
    const duplicate = launch(executable, ['--port', String(port)]);
    assert.equal((await withTimeout(duplicate.done, 'Duplicate launcher did not exit')).code, 0);
    assert.match(duplicate.stdout, /NAIWA_REUSED/);
    assert.equal((await request(port)).status, 200);
  });

  await t.test('a different copy cannot silently adopt the occupied port; junctions cannot escape www', async () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'naiwa-portable-test-'));
    const fixtureExe = path.join(fixture, 'Launcher.exe');
    copyFileSync(executable, fixtureExe);
    mkdirSync(path.join(fixture, 'www'));
    writeFileSync(path.join(fixture, 'www/index.html'), '<html>fixture</html>');
    mkdirSync(path.join(fixture, 'private'));
    writeFileSync(path.join(fixture, 'private/secret.txt'), 'must not escape');
    symlinkSync(path.join(fixture, 'private'), path.join(fixture, 'www/escape'), 'junction');
    try {
      const conflict = launch(fixtureExe, ['--port', String(port)]);
      assert.notEqual((await withTimeout(conflict.done, 'Conflicting copy did not exit')).code, 0);
      assert.match(conflict.stderr, /occupied/);
      const otherPort = await unusedPort();
      const fixtureApp = launch(fixtureExe, ['--port', String(otherPort)]);
      try {
        await ready(fixtureApp);
        assert.equal((await request(otherPort, '/escape/secret.txt')).status, 403);
        assert.equal((await request(otherPort, '/private/secret.txt')).status, 404);
        assert.equal((await request(otherPort)).status, 200);
      } finally { await stop(fixtureApp); }
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });

  await t.test('default port 4178 reports an unrelated occupant and leaves it running', async t => {
    const occupant = net.createServer(socket => { socket.on('error', () => {}); socket.on('data', () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 9\r\nConnection: close\r\n\r\nother-app')); });
    try { await listen(occupant, 4178); }
    catch (error) { if (error.code === 'EADDRINUSE') { t.skip('Default port is already used by a user application.'); return; } throw error; }
    try {
      const conflict = launch(executable, []);
      assert.notEqual((await withTimeout(conflict.done, 'Port conflict did not exit')).code, 0);
      assert.match(conflict.stderr, /4178.*occupied/);
      assert.equal((await request(4178)).body.toString(), 'other-app');
    } finally { await close(occupant); }
  });

  await t.test('graceful exit releases its port and a restart retains the same URL', async () => {
    assert.equal((await stop(app)).code, 0);
    const probe = net.createServer();
    await listen(probe, port);
    await close(probe);
    const restarted = launch(executable, ['--port', String(port)]);
    try {
      await ready(restarted);
      assert.match(restarted.stdout, new RegExp(`http://127\\.0\\.0\\.1:${port}/`));
      assert.equal((await request(port)).status, 200);
    } finally { assert.equal((await stop(restarted)).code, 0); }
  });
});
