const fs = require('fs');
const path = require('path');

const memoryCache = new Map();

function getMemoryCache(key, ttlMs) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > ttlMs) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function setMemoryCache(key, value) {
  memoryCache.set(key, {
    value,
    updatedAt: Date.now()
  });
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

module.exports = {
  getMemoryCache,
  setMemoryCache,
  readJsonFile,
  writeJsonFile,
  ensureDirectory
};
