// Large personal checkpoints exceed WeChat's single storage-key limit. Switch the
// small pointer only after writing the alternate file, so a failed save is retryable.
function pointer(key) {
  const raw = wx.getStorageSync(key);
  return typeof raw === 'string' && raw ? JSON.parse(raw) : raw;
}
function fileSlot(entry) {
  return entry && entry.format === 'task-file-v1' && (entry.slot === 0 || entry.slot === 1);
}
function filename(key, slot) {
  return wx.env.USER_DATA_PATH + '/' + encodeURIComponent(key) + '-' + slot + '.json';
}
function deleteFile(key, entry) {
  if (!fileSlot(entry)) return;
  try { wx.getFileSystemManager().unlinkSync(filename(key, entry.slot)); } catch (e) { /* already absent */ }
}
function read(key) {
  const entry = pointer(key);
  return fileSlot(entry) ? JSON.parse(wx.getFileSystemManager().readFileSync(filename(key, entry.slot), 'utf8')) : entry;
}
function write(key, value) {
  const json = JSON.stringify(value), previous = pointer(key);
  if (json.length < 240 * 1024) {
    wx.setStorageSync(key, json);
  } else {
    const next = { format: 'task-file-v1', slot: fileSlot(previous) && previous.slot === 0 ? 1 : 0, ts: value.ts };
    wx.getFileSystemManager().writeFileSync(filename(key, next.slot), json, 'utf8');
    try { wx.setStorageSync(key, JSON.stringify(next)); }
    catch (e) { deleteFile(key, next); throw e; }
  }
  deleteFile(key, previous);
}
function remove(key) {
  const entry = pointer(key);
  wx.removeStorageSync(key);
  deleteFile(key, entry);
}
module.exports = { read, write, remove };
