// 租户管理：客户提交 Lark 凭证 → 即时验证 → 加密存盘 → 托管运行其 bot。
// App Secret 用 AES-256-GCM 加密存储；manageToken 让客户自助改配置/删除。
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { createTenantBot } from './bot-factory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const STORE = join(DATA_DIR, 'tenants.json');
mkdirSync(DATA_DIR, { recursive: true });

// 加密密钥：从 env 取，派生成 32 字节。未配置则用弱默认——生产必须配 TENANT_SECRET_KEY，
// 否则所有 App Secret 用公开已知密钥加密（等同明文）。缺失时大声警告。
if (!process.env.TENANT_SECRET_KEY) {
  console.error('⚠️⚠️ 未配置 TENANT_SECRET_KEY！客户凭证将用弱默认密钥加密，生产环境不安全，请立即在 .env 配置！');
}
const KEY = createHash('sha256')
  .update(process.env.TENANT_SECRET_KEY || 'onlyrouter-dev-insecure-key')
  .digest();

function encrypt(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}
function decrypt(blob) {
  const [ivB, tagB, encB] = blob.split(':');
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB, 'base64')), decipher.final()]).toString('utf8');
}

// ---- 存储读写 ----
function readStore() {
  if (!existsSync(STORE)) return [];
  try { return JSON.parse(readFileSync(STORE, 'utf8')); } catch { return []; }
}
function writeStore(list) {
  // 原子写：先写临时文件再 rename，避免进程写一半崩溃导致 tenants.json 损坏、
  // 下次 JSON.parse 失败被吞成 []、所有租户静默消失。
  const tmp = STORE + '.tmp';
  writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  renameSync(tmp, STORE);
}

// 串行锁：所有"读 list → await 验证 → 写回"的写操作排队执行，一次只跑一个，
// 杜绝并发时两个操作各持旧快照、后写覆盖前写导致丢租户。
let lockChain = Promise.resolve();
function withLock(fn) {
  const run = lockChain.then(fn, fn); // 无论前一个成功失败都继续，不断链
  lockChain = run.catch(() => {});
  return run;
}

// ---- 即时验证凭证：调 Lark 拿 tenant_access_token，通了才算有效 ----
async function verifyCredential({ appId, appSecret, domain }) {
  const base = domain === 'feishu' ? 'https://open.feishu.cn' : 'https://open.larksuite.com';
  const res = await fetch(`${base}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json().catch(() => ({}));
  if (json.code === 0 && json.tenant_access_token) return { ok: true };
  return { ok: false, error: json.msg || `验证失败(code=${json.code})`, raw: json };
}
// ---- 运行态：tenantId → bot 实例 ----
const running = new Map();

function startBot(rec) {
  if (running.has(rec.tenantId)) return;
  const bot = createTenantBot({
    appId: rec.appId,
    appSecret: decrypt(rec.appSecretEnc),
    domain: rec.domain,
    tenantId: rec.tenantId,
    label: rec.name || rec.tenantId,
  });
  bot.start();
  running.set(rec.tenantId, bot);
}
function stopBot(tenantId) {
  const bot = running.get(tenantId);
  if (bot) { bot.stop(); running.delete(tenantId); }
}

// 启动时拉起所有 active 租户
export function loadAll() {
  const list = readStore();
  let n = 0;
  for (const rec of list) {
    if (rec.status === 'active') {
      try { startBot(rec); n++; } catch (e) { console.error(`[tenant] 启动 ${rec.tenantId} 失败:`, e.message); }
    }
  }
  console.log(`[tenant] 已托管 ${n} 个客户 bot`);
}

// 新增租户：先验证 → 存 → 启动 → 返回 manageToken（整段串行执行，防并发覆盖）
export async function addTenant({ name, appId, appSecret, domain }) {
  if (!appId || !appSecret) return { ok: false, error: '请填写 App ID 和 App Secret' };
  const v = await verifyCredential({ appId, appSecret, domain });
  if (!v.ok) return { ok: false, error: v.error };
  return withLock(() => {
    const list = readStore();
    // 同 appId 已存在则视为重复（在锁内检查，避免并发双插）
    if (list.some((r) => r.appId === appId)) {
      return { ok: false, error: '这个 App ID 已经接入过了。如需修改请用管理令牌，或换个应用。' };
    }
    const tenantId = randomUUID().slice(0, 8);
    const manageToken = randomBytes(16).toString('hex');
    const rec = {
      tenantId,
      name: (name || '未命名').slice(0, 40),
      appId,
      appSecretEnc: encrypt(appSecret),
      domain: domain === 'feishu' ? 'feishu' : 'lark',
      manageTokenHash: createHash('sha256').update(manageToken).digest('hex'),
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    list.push(rec);
    writeStore(list);
    try { startBot(rec); } catch (e) { console.error('[tenant] 启动失败:', e.message); }
    return { ok: true, tenantId, manageToken };
  });
}

function auth(tenantId, manageToken) {
  const list = readStore();
  const rec = list.find((r) => r.tenantId === tenantId);
  if (!rec) return { rec: null, list, err: '找不到这个接入记录' };
  const hash = createHash('sha256').update(manageToken || '').digest('hex');
  if (hash !== rec.manageTokenHash) return { rec: null, list, err: '管理令牌不对' };
  return { rec, list };
}

// 改凭证（重新验证 + 重启，串行执行）
export async function updateTenant({ tenantId, manageToken, name, appId, appSecret, domain }) {
  return withLock(async () => {
    const { rec, list, err } = auth(tenantId, manageToken);
    if (err) return { ok: false, error: err };
    const newAppId = appId || rec.appId;
    const newDomain = domain === 'feishu' ? 'feishu' : domain === 'lark' ? 'lark' : rec.domain;
    const newSecret = appSecret || decrypt(rec.appSecretEnc);
    const v = await verifyCredential({ appId: newAppId, appSecret: newSecret, domain: newDomain });
    if (!v.ok) return { ok: false, error: v.error };
    if (name) rec.name = name.slice(0, 40);
    rec.appId = newAppId;
    rec.domain = newDomain;
    rec.appSecretEnc = encrypt(newSecret);
    writeStore(list);
    stopBot(tenantId);
    if (rec.status === 'active') startBot(rec);
    return { ok: true };
  });
}

// 暂停/恢复（串行执行）
export function toggleTenant({ tenantId, manageToken, action }) {
  return withLock(() => {
    const { rec, list, err } = auth(tenantId, manageToken);
    if (err) return { ok: false, error: err };
    if (action === 'pause') { rec.status = 'paused'; stopBot(tenantId); }
    else if (action === 'resume') { rec.status = 'active'; startBot(rec); }
    else return { ok: false, error: '未知操作' };
    writeStore(list);
    return { ok: true, status: rec.status };
  });
}

// 删除（串行执行）
export function removeTenant({ tenantId, manageToken }) {
  return withLock(() => {
    const { rec, list, err } = auth(tenantId, manageToken);
    if (err) return { ok: false, error: err };
    stopBot(tenantId);
    writeStore(list.filter((r) => r.tenantId !== tenantId));
    return { ok: true };
  });
}

// 查一个租户的状态（凭令牌）
export function getTenant({ tenantId, manageToken }) {
  const { rec, err } = auth(tenantId, manageToken);
  if (err) return { ok: false, error: err };
  return { ok: true, tenant: { tenantId: rec.tenantId, name: rec.name, appId: rec.appId, domain: rec.domain, status: rec.status, createdAt: rec.createdAt } };
}

