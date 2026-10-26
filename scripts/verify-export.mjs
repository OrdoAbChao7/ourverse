#!/usr/bin/env node
/**
 * Verifies an OURVERSE offline museum directory or ZIP.
 *
 * Usage:
 *   node scripts/verify-export.mjs <directory-or-zip> [--strict]
 *
 * The script needs only Node's built-in modules plus fflate. It does not
 * extract archives to disk: ZIP entries are read and hashed in memory.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import process from 'node:process';
import { TextDecoder } from 'node:util';
import { unzipSync } from 'fflate';

const STRICT_PATTERNS = ['http://', 'https://', 'fetch(', 'type="module"', '<script src='];
const SUMS_FILE = 'SHA256SUMS.txt';

function out(line = '') {
  process.stdout.write(`${line}\n`);
}

function err(line = '') {
  process.stderr.write(`${line}\n`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizePath(value) {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isSafeRelative(path) {
  if (!path) return false;
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false;
  return !path.split('/').includes('..');
}

function collectDirectory(root) {
  const entries = new Map();
  const unsafe = [];

  function walk(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, item.name);
      if (item.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!item.isFile()) continue;
      const path = normalizePath(relative(root, fullPath).split(sep).join('/'));
      if (!isSafeRelative(path)) {
        unsafe.push(path);
        continue;
      }
      entries.set(path, readFileSync(fullPath));
    }
  }

  walk(root);
  return { entries, unsafe, kind: '目录' };
}

function collectZip(filePath) {
  const raw = readFileSync(filePath);
  const isZip = raw.length >= 2 && raw[0] === 0x50 && raw[1] === 0x4b;
  if (!isZip) {
    throw new Error('输入文件不是有效的 ZIP 压缩包。');
  }
  const unpacked = unzipSync(new Uint8Array(raw));
  const entries = new Map();
  const unsafe = [];
  for (const [name, bytes] of Object.entries(unpacked)) {
    if (name.endsWith('/')) continue;
    const path = normalizePath(name);
    if (!isSafeRelative(path)) {
      unsafe.push(path);
      continue;
    }
    entries.set(path, bytes);
  }
  return { entries, unsafe, kind: 'ZIP' };
}

function readPackage(input) {
  const stats = statSync(input);
  if (stats.isDirectory()) return collectDirectory(input);
  if (stats.isFile()) return collectZip(input);
  throw new Error('路径既不是目录，也不是文件。');
}

function parseSums(text) {
  const entries = new Map();
  const problems = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const match = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line);
    if (!match) {
      problems.push(`SHA256SUMS.txt 第 ${index + 1} 行格式无法识别`);
      return;
    }
    const hash = match[1].toLowerCase();
    const path = normalizePath(match[2]);
    if (!isSafeRelative(path)) {
      problems.push(`SHA256SUMS.txt 第 ${index + 1} 行包含不安全的路径：${path}`);
      return;
    }
    if (entries.has(path)) {
      problems.push(`SHA256SUMS.txt 含重复条目：${path}`);
      return;
    }
    entries.set(path, hash);
  });
  return { entries, problems };
}

function scanStrict(entries) {
  const index = entries.get('index.html');
  const problems = [];
  if (!index) {
    return { problems: ['严格模式要求存在 index.html，但包内没有找到。'] };
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(index);
  const lower = text.toLowerCase();
  for (const pattern of STRICT_PATTERNS) {
    if (!lower.includes(pattern)) continue;
    const lines = text.split(/\r?\n/);
    const lineIndex = lines.findIndex((line) => line.toLowerCase().includes(pattern));
    problems.push(`index.html 第 ${lineIndex + 1} 行包含 ${pattern}`);
  }
  return { problems };
}

function usage() {
  err('用法：node scripts/verify-export.mjs <目录或 ZIP 路径> [--strict]');
  err('  --strict  额外检查 index.html 是否包含远程引用或模块脚本');
}

function main() {
  const rawArgs = process.argv.slice(2);
  const unknownFlags = rawArgs.filter((arg) => arg.startsWith('--') && arg !== '--strict');
  if (unknownFlags.length > 0) {
    err(`未知参数：${unknownFlags.join(' ')}`);
    usage();
    return 1;
  }
  const strict = rawArgs.includes('--strict');
  const positional = rawArgs.filter((arg) => arg !== '--strict');
  if (positional.length !== 1) {
    usage();
    return 1;
  }

  const input = positional[0];
  let pack;
  try {
    pack = readPackage(input);
  } catch (error) {
    err(`无法读取离线博物馆：${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const sumsBytes = pack.entries.get(SUMS_FILE);
  if (!sumsBytes) {
    err(`包内缺少 ${SUMS_FILE}，无法校验完整性。`);
    return 1;
  }

  const sumsText = new TextDecoder('utf-8', { fatal: false }).decode(sumsBytes);
  const { entries: listed, problems: parseProblems } = parseSums(sumsText);
  if (parseProblems.length > 0) {
    for (const problem of parseProblems) err(`[ERROR] ${problem}`);
    return 1;
  }
  if (listed.size === 0) {
    err(`${SUMS_FILE} 中没有可校验的条目。`);
    return 1;
  }

  out('OURVERSE 离线博物馆校验');
  out(`输入：${input}`);
  out(`类型：${pack.kind}`);
  out(`清单：${SUMS_FILE}，共 ${listed.size} 个文件`);
  out('');

  const sortedPaths = [...listed.keys()].sort();
  const expectedSet = new Set(sortedPaths);
  const extras = [...pack.entries.keys()]
    .filter((path) => path !== SUMS_FILE && !expectedSet.has(path))
    .sort();
  const unsafeExtras = pack.unsafe.filter((path) => !expectedSet.has(path)).sort();

  let passed = 0;
  let missing = 0;
  let mismatched = 0;
  for (const path of sortedPaths) {
    const actual = pack.entries.get(path);
    if (!actual) {
      missing += 1;
      out(`[MISSING] ${path}`);
      continue;
    }
    const actualHash = sha256(actual);
    if (actualHash !== listed.get(path)) {
      mismatched += 1;
      out(`[FAIL]    ${path}`);
      out(`          期望 ${listed.get(path)}`);
      out(`          实际 ${actualHash}`);
      continue;
    }
    passed += 1;
    out(`[OK]      ${path}`);
  }

  for (const path of extras) out(`[EXTRA]   ${path}（未纳入 SHA256SUMS.txt）`);
  for (const path of unsafeExtras) out(`[EXTRA]   ${path}（不安全路径，未读取）`);

  const strictProblems = strict ? scanStrict(pack.entries).problems : [];
  if (strict) {
    for (const problem of strictProblems) err(`[STRICT]  ${problem}`);
  }

  out('');
  out(`结果：${passed} 个文件通过，${missing} 个缺失，${mismatched} 个哈希不匹配，${extras.length + unsafeExtras.length} 个额外文件。`);
  if (strict) {
    out(strictProblems.length === 0 ? '严格模式：未发现远程引用或模块脚本。' : `严格模式：发现 ${strictProblems.length} 处问题。`);
  }

  const failed = missing > 0 || mismatched > 0 || strictProblems.length > 0;
  out(failed ? '校验失败：离线博物馆不完整或已被修改。' : '校验通过：哈希全部一致。');
  return failed ? 1 : 0;
}

process.exitCode = main();
