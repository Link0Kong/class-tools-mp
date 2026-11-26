// Windows DevTools transport probe. The synthetic client sends only to a loopback listener.
const { execFile } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const automator = require('miniprogram-automator');

const root = path.resolve(__dirname, '..');
const projectConfig = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const sdk = process.argv[2] || projectConfig.libVersion;
if (!/^\d+\.\d+\.\d+$/.test(sdk)) throw Error('Expected an SDK version such as 3.17.4');
const cli = process.env.WX_DEVTOOLS_CLI || path.join(process.env['ProgramFiles(x86)'],
  'Tencent', '微信web开发者工具', 'cli.bat');

function bounded(promise, timeout, label) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ' timed out')), timeout); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

async function cliCommand(project, port, action) {
  const commands = {
    open: '& $env:WX_QA_CLI open --project $env:WX_QA_PROJECT --lang en',
    auto: '& $env:WX_QA_CLI auto --project $env:WX_QA_PROJECT --auto-port $env:WX_QA_PORT --trust-project --lang en',
    close: '& $env:WX_QA_CLI close --project $env:WX_QA_PROJECT --lang en'
  };
  try {
    const run = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', commands[action]], {
      windowsHide: true, timeout: action === 'auto' ? 60000 : 15000, env: { ...process.env, WX_QA_CLI: cli,
        WX_QA_PROJECT: project, WX_QA_PORT: String(port) }
    });
    if (/\[error\]/i.test(run.stderr + run.stdout)) throw Error('project rejected');
  } catch (error) { throw Error('DevTools ' + action + ' failed for ' + project + ' (' + (error.code || 'timeout or rejection') + ')'); }
}

async function availablePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

function makeProject(dir) {
  fs.mkdirSync(path.join(dir, 'pages', 'probe'), { recursive: true });
  const write = (name, value) => fs.writeFileSync(path.join(dir, name),
    typeof value === 'string' ? value : JSON.stringify(value));
  write('project.config.json', { appid: projectConfig.appid, projectname: 'local-patch-probe',
    compileType: 'miniprogram', miniprogramRoot: './', libVersion: sdk, setting: { urlCheck: false, es6: true } });
  write('project.private.config.json', { libVersion: sdk, setting: { urlCheck: false } });
  write('app.json', { pages: ['pages/probe/probe'] });
  write('app.js', 'App({});');
  write('pages/probe/probe.js', 'Page({});');
  write('pages/probe/probe.wxml', '<view>Local transport check</view>');
}

async function connect(port) {
  const deadline = Date.now() + 45000;
  let last;
  while (Date.now() < deadline) {
    try {
      return await bounded(automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + port }), 4500, 'automator connect');
    } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw last;
}

async function run() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'classtools-patch-'));
  const project = path.join(temp, 'project');
  makeProject(project);
  const observed = {};
  const server = http.createServer((req, res) => {
    const requested = req.url.slice(1);
    if (!['GET', 'POST', 'PATCH'].includes(requested)) { res.writeHead(404); res.end(); return; }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      observed[requested] = { method: req.method, syntheticBody: body === '{"synthetic":true}' };
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ method: req.method }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const port = await availablePort();
  let mini;
  try {
    console.log('Opening isolated project for SDK ' + sdk + ' on automation port ' + port);
    await cliCommand(project, port, 'open');
    await cliCommand(project, port, 'auto');
    mini = await connect(port);
    const sys = await bounded(mini.callWxMethod('getSystemInfo'), 15000, 'getSystemInfo');
    const replies = {};
    for (const method of ['GET', 'POST', 'PATCH']) {
      const options = { method, url: base + '/' + method, timeout: 5000 };
      if (method !== 'GET') options.data = { synthetic: true };
      try {
        const reply = await bounded(mini.callWxMethod('request', options), 10000, method);
        replies[method] = { status: reply.statusCode, received: reply.data && reply.data.method, result: reply.errMsg };
      } catch (error) { replies[method] = { error: error.message }; }
    }
    const report = { requestedSdk: sdk, observedSdk: sys.SDKVersion, replies, observed };
    const filename = path.join(temp, 'result.json');
    fs.writeFileSync(filename, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2), '\n' + filename);
    if (!sys.SDKVersion || !['GET', 'POST'].every(m => observed[m] && observed[m].method === m &&
      replies[m].status === 200) || !observed.POST.syntheticBody) throw Error('Transport controls failed');
    if (!observed.PATCH || observed.PATCH.method !== 'PATCH' || !observed.PATCH.syntheticBody ||
        replies.PATCH.status !== 200) throw Error('PATCH did not reach the listener as sent');
  } finally {
    if (mini) mini.disconnect();
    await new Promise(resolve => server.close(resolve));
    await cliCommand(project, port, 'close').catch(() => {});
  }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
