// Isolated WeChat JS module graph and persistent storage, backed by a supplied wx.request adapter.
const vm = require('node:vm');
const path = require('node:path');
const { readFileSync } = require('node:fs');

function device(host, storage = {}) {
  const root = path.resolve(__dirname, '..');
  const modules = new Map();
  const device = { storage, intercept: null };
  const wx = {
    getStorageSync: key => storage[key] || '',
    setStorageSync: (key, val) => { storage[key] = val; },
    removeStorageSync: key => { delete storage[key]; },
    getStorageInfoSync: () => ({ keys: Object.keys(storage) }),
    showToast() {}, reLaunch() {}, showShareMenu() {},
    showModal(opts) { if (opts.success) opts.success({ confirm: true }); },
    request(req) { Promise.resolve().then(() => {
      if (!device.intercept || !device.intercept(req)) host.respond(req);
    }).catch(error => req.fail(error)); }
  };
  // Debounced background flushes are driven explicitly by these tests.
  let page;
  const context = vm.createContext({ wx, console, setTimeout: () => 1, clearTimeout() {}, Date,
    Page(definition) { page = definition; }, getCurrentPages: () => [] });
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    if (file.endsWith('cloud-config.js')) return { enabled: true, restBase: 'https://qa.invalid/', net: { retryAttempts: 1 } };
    const module = { exports: {} };
    modules.set(file, module);
    const factory = vm.runInContext('(function(require,module,exports){' + readFileSync(file, 'utf8') + '\n})', context, { filename: file });
    factory(name => load(path.resolve(path.dirname(file), name.endsWith('.js') ? name : name + '.js')), module, module.exports);
    return module.exports;
  }
  device.wx = wx;
  device.util = name => load(path.join(root, 'utils', name + '.js'));
  device.page = name => {
    const file = path.join(root, 'pages', name + '.js');
    modules.delete(file); load(file);
    const instance = Object.assign({}, page, { data: JSON.parse(JSON.stringify(page.data)),
      setData(values, next) { Object.assign(this.data, values); if (next) next(); } });
    return instance;
  };
  device.task = load(path.join(root, 'utils/task.js'));
  device.identity = load(path.join(root, 'utils/identity.js'));
  device.login = (id, ticket) => device.identity.save({ sid: id, name: '测试身份', token: id + '/' + ticket });
  device.login('9999000001', 'one');
  return device;
}
module.exports = { device };
