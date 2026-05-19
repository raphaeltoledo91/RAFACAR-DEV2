import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

const rootDir = process.cwd();
const dataDir = path.join(rootDir, 'data');
const distDir = path.join(rootDir, 'dist');
const configFile = path.join(dataDir, 'config.local.json');
const configExampleFile = path.join(dataDir, 'config.local.example.json');

function readJsonSafe(file, fallback = {}) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; }
  catch (error) { console.error(`[config] Falha ao ler ${file}:`, error.message); return fallback; }
}

function ensureConfigFiles() {
  fs.mkdirSync(dataDir, { recursive: true });
  const example = { traccarUrl: 'https://gps2.rafacarrastreadores.com.br', port: 3000, pollingMs: 30000, allowUnsafeGoogleTiles: true, sessionTtlHours: 8 };
  if (!fs.existsSync(configExampleFile)) fs.writeFileSync(configExampleFile, `${JSON.stringify(example, null, 2)}\n`);
  if (!fs.existsSync(configFile)) fs.writeFileSync(configFile, `${JSON.stringify(example, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(configFile, 0o600); } catch { /* ignore */ }
}

ensureConfigFiles();
const localConfig = readJsonSafe(configFile, {});
const config = {
  port: Number(process.env.PORT || localConfig.port || 3000),
  traccarUrl: String(process.env.TRACCAR_URL || localConfig.traccarUrl || 'https://gps2.rafacarrastreadores.com.br').replace(/\/+$/, ''),
  pollingMs: Number(process.env.POLLING_MS || localConfig.pollingMs || 30000),
  allowUnsafeGoogleTiles: String(process.env.ALLOW_UNSAFE_GOOGLE_TILES ?? localConfig.allowUnsafeGoogleTiles ?? 'true') !== 'false',
  sessionTtlMs: Number(process.env.SESSION_TTL_MS || (Number(localConfig.sessionTtlHours || 8) * 60 * 60 * 1000))
};

const app = express();
const allowedMethods = new Set(['GET', 'POST', 'PUT', 'DELETE']);
const endpointAllowList = [
  /^\/api\/server$/, /^\/api\/session$/, /^\/api\/users(?:\/\d+)?$/, /^\/api\/permissions$/, /^\/api\/statistics$/,
  /^\/api\/devices(?:\/\d+)?$/, /^\/api\/positions(?:\/\d+)?$/, /^\/api\/events$/, /^\/api\/groups(?:\/\d+)?$/,
  /^\/api\/drivers(?:\/\d+)?$/, /^\/api\/geofences(?:\/\d+)?$/, /^\/api\/calendars(?:\/\d+)?$/,
  /^\/api\/attributes\/computed(?:\/\d+)?$/, /^\/api\/notifications(?:\/\d+)?$/, /^\/api\/notifications\/types$/,
  /^\/api\/maintenance(?:\/\d+)?$/, /^\/api\/commands(?:\/\d+)?$/, /^\/api\/commands\/types$/, /^\/api\/commands\/send$/,
  /^\/api\/reports\/(events|route|trips|stops|summary)$/, /^\/api\/geocode$/, /^\/api\/geocode\/reverse$/
];

const COOKIE_NAME = 'rafacar_sid';
const sessions = new Map();

function isAllowedEndpoint(urlPath) { return endpointAllowList.some((rx) => rx.test(urlPath)); }
function safePublicConfig(req = null) { return { pollingMs: config.pollingMs, traccarUrl: config.traccarUrl, authMode: 'traccar-user-session', authenticated: Boolean(req ? getSession(req) : false), configExists: fs.existsSync(configFile), allowUnsafeGoogleTiles: config.allowUnsafeGoogleTiles }; }
function redact(value) { if (!value) return ''; const s = String(value); return s.length <= 8 ? '********' : `${s.slice(0, 4)}…${s.slice(-4)}`; }
function parseCookies(req) { const header = req.headers.cookie || ''; return Object.fromEntries(header.split(';').map((part) => { const [key, ...rest] = part.trim().split('='); if (!key) return null; return [decodeURIComponent(key), decodeURIComponent(rest.join('=') || '')]; }).filter(Boolean)); }
function cookieOptions(req) { const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https'; return { httpOnly: true, sameSite: 'lax', secure: Boolean(isSecure), path: '/', maxAge: config.sessionTtlMs }; }
function parseSetCookie(headers) { const raw = headers.get('set-cookie'); if (!raw) return ''; return raw.split(/,(?=[^;,]+=)/g).map((part) => part.split(';')[0].trim()).filter(Boolean).join('; '); }
function sanitizeUser(payload, fallbackLogin = '') { const user = payload && typeof payload === 'object' ? payload : {}; return { id: user.id ?? null, name: user.name || user.email || fallbackLogin, email: user.email || fallbackLogin, administrator: Boolean(user.administrator), readonly: Boolean(user.readonly), deviceReadonly: Boolean(user.deviceReadonly), disabled: Boolean(user.disabled) }; }
function createLocalSession(req, res, remoteCookie, user) { const sid = crypto.randomBytes(32).toString('base64url'); const now = Date.now(); sessions.set(sid, { sid, remoteCookie, user, createdAt: now, lastSeenAt: now, expiresAt: now + config.sessionTtlMs }); res.cookie(COOKIE_NAME, sid, cookieOptions(req)); return sid; }
function destroyLocalSession(req, res) { const sid = parseCookies(req)[COOKIE_NAME]; if (sid) sessions.delete(sid); res.clearCookie(COOKIE_NAME, { path: '/' }); }
function cleanupSessions() { const now = Date.now(); for (const [sid, session] of sessions.entries()) if (!session?.expiresAt || session.expiresAt <= now) sessions.delete(sid); }
function getSession(req) { cleanupSessions(); const sid = parseCookies(req)[COOKIE_NAME]; if (!sid) return null; const session = sessions.get(sid); if (!session) return null; if (session.expiresAt <= Date.now()) { sessions.delete(sid); return null; } session.lastSeenAt = Date.now(); session.expiresAt = Date.now() + config.sessionTtlMs; return session; }
function requireAuth(req, res, next) { const session = getSession(req); if (!session) return res.status(401).json({ ok: false, error: 'Login necessário. Entre com as credenciais do Traccar.' }); req.rafacarSession = session; return next(); }

async function loginToTraccar(login, password) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const body = new URLSearchParams({ email: login, password });
    const response = await fetch(`${config.traccarUrl}/api/session`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: controller.signal, redirect: 'manual' });
    const setCookie = parseSetCookie(response.headers); const text = await response.text(); let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text ? { raw: text } : null; }
    if (!response.ok || !setCookie) { const message = payload?.message || payload?.error || payload?.raw || `Traccar retornou HTTP ${response.status}`; const error = new Error(String(message).slice(0, 500)); error.status = response.status || 401; throw error; }
    return { remoteCookie: setCookie, user: sanitizeUser(payload, login) };
  } catch (error) { if (error.name === 'AbortError') throw new Error('Tempo esgotado ao autenticar no Traccar.'); throw error; }
  finally { clearTimeout(timeout); }
}

function buildAuthHeaders(req, extra = {}) { const session = req.rafacarSession || getSession(req); if (!session?.remoteCookie) { const error = new Error('Sessão Traccar não encontrada. Faça login novamente.'); error.status = 401; throw error; } return { Accept: 'application/json', Cookie: session.remoteCookie, ...extra }; }

async function traccarFetch(req, apiPath, options = {}) {
  if (!apiPath.startsWith('/api/')) throw new Error('Caminho interno inválido para proxy Traccar.');
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 18000)); const url = `${config.traccarUrl}${apiPath}`;
  try {
    const response = await fetch(url, { method: options.method || 'GET', headers: buildAuthHeaders(req, options.headers), body: options.body, signal: controller.signal, redirect: 'manual' });
    const setCookie = parseSetCookie(response.headers); if (setCookie) { const session = req.rafacarSession || getSession(req); if (session) session.remoteCookie = setCookie; }
    const contentType = response.headers.get('content-type') || ''; const text = await response.text(); let payload = null;
    if (contentType.includes('application/json')) { try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; } } else { payload = text ? { raw: text } : null; }
    if (response.status === 401) { const sid = parseCookies(req)[COOKIE_NAME]; if (sid) sessions.delete(sid); }
    if (!response.ok) { const message = payload?.message || payload?.error || payload?.raw || `Traccar retornou HTTP ${response.status}`; const error = new Error(String(message).slice(0, 500)); error.status = response.status; error.payload = payload; throw error; }
    return payload;
  } catch (error) { if (error.name === 'AbortError') throw new Error('Tempo esgotado ao conectar ao Traccar.'); throw error; }
  finally { clearTimeout(timeout); }
}

function recentIso(hoursBack = 24) { return new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString(); }
function nowIso() { return new Date().toISOString(); }
async function buildSnapshot(req) {
  const eventsPath = `/api/reports/events?from=${encodeURIComponent(recentIso(24))}&to=${encodeURIComponent(nowIso())}`;
  const [server, devices, positions, events] = await Promise.allSettled([traccarFetch(req, '/api/server'), traccarFetch(req, '/api/devices'), traccarFetch(req, '/api/positions'), traccarFetch(req, eventsPath)]);
  return { ok: true, user: req.rafacarSession?.user || null, server: server.status === 'fulfilled' ? server.value : null, devices: devices.status === 'fulfilled' && Array.isArray(devices.value) ? devices.value : [], positions: positions.status === 'fulfilled' && Array.isArray(positions.value) ? positions.value : [], events: events.status === 'fulfilled' && Array.isArray(events.value) ? events.value : [], errors: [server, devices, positions, events].filter((item) => item.status === 'rejected').map((item) => item.reason?.message || String(item.reason)), config: safePublicConfig(req) };
}

app.disable('x-powered-by'); app.set('trust proxy', 1);
const connectSrc = ["'self'", 'https://*.tile.openstreetmap.org', 'https://*.basemaps.cartocdn.com', 'https://server.arcgisonline.com'];
const imgSrc = ["'self'", 'data:', 'blob:', 'https:'];
if (config.allowUnsafeGoogleTiles) connectSrc.push('https://mt0.google.com', 'https://mt1.google.com', 'https://mt2.google.com', 'https://mt3.google.com');
app.use(helmet({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: { useDefaults: true, directives: { "default-src": ["'self'"], "connect-src": connectSrc, "img-src": imgSrc, "style-src": ["'self'", "'unsafe-inline'", 'https:'], "script-src": ["'self'"], "font-src": ["'self'", 'data:'], "object-src": ["'none'"], "base-uri": ["'self'"] } } }));
app.use(compression()); app.use(express.json({ limit: '512kb' })); app.use(express.urlencoded({ extended: false, limit: '512kb' })); app.use(morgan('combined'));
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false }));
const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { ok: false, error: 'Muitas tentativas de login. Aguarde alguns minutos.' } });

app.get('/api/health', (req, res) => { const session = getSession(req); res.set('Cache-Control', 'no-store'); res.json({ ok: true, service: 'rafacar-dev2', version: '6.0.0-login-traccar', port: config.port, traccarUrl: config.traccarUrl, authMode: 'traccar-user-session', authenticated: Boolean(session), sessions: sessions.size, configExists: fs.existsSync(configFile), user: session?.user ? redact(session.user.email || session.user.name) : '' }); });
app.get('/api/config', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ok: true, config: safePublicConfig(req) }); });
app.post('/api/auth/login', loginLimiter, async (req, res) => { try { const body = req.body || {}; const login = String(body.email || body.user || body.username || '').trim(); const password = String(body.password || ''); if (!login || login.length > 180) return res.status(400).json({ ok: false, error: 'Usuário/e-mail inválido.' }); if (!password || password.length > 300) return res.status(400).json({ ok: false, error: 'Senha inválida.' }); const { remoteCookie, user } = await loginToTraccar(login, password); createLocalSession(req, res, remoteCookie, user); res.set('Cache-Control', 'no-store'); return res.json({ ok: true, user, config: safePublicConfig(req) }); } catch (error) { return res.status(error.status || 401).json({ ok: false, error: error.message || 'Login inválido no Traccar.' }); } });
app.post('/api/auth/logout', (req, res) => { destroyLocalSession(req, res); res.set('Cache-Control', 'no-store'); res.json({ ok: true }); });
app.get('/api/auth/me', requireAuth, async (req, res) => { try { const remoteUser = await traccarFetch(req, '/api/session'); req.rafacarSession.user = sanitizeUser(remoteUser, req.rafacarSession.user?.email || ''); res.set('Cache-Control', 'no-store'); res.json({ ok: true, authenticated: true, user: req.rafacarSession.user, config: safePublicConfig(req) }); } catch { destroyLocalSession(req, res); res.status(401).json({ ok: false, authenticated: false, error: 'Sessão expirada. Faça login novamente.' }); } });
app.get('/api/bootstrap', requireAuth, async (req, res) => { try { res.set('Cache-Control', 'no-store'); res.json(await buildSnapshot(req)); } catch (error) { res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao carregar dados iniciais.' }); } });
app.get('/api/snapshot', requireAuth, async (req, res) => { try { res.set('Cache-Control', 'no-store'); res.json(await buildSnapshot(req)); } catch (error) { res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao atualizar dados.' }); } });
app.get('/api/command-types', requireAuth, async (req, res) => { try { const deviceId = Number(req.query.deviceId); const query = Number.isFinite(deviceId) && deviceId > 0 ? `?deviceId=${deviceId}` : ''; const payload = await traccarFetch(req, `/api/commands/types${query}`); res.set('Cache-Control', 'no-store'); res.json(Array.isArray(payload) ? payload : []); } catch (error) { res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao carregar comandos.' }); } });
app.post('/api/send-command', requireAuth, async (req, res) => { try { const body = req.body || {}; const deviceId = Number(body.deviceId); const type = String(body.type || '').trim(); if (!Number.isFinite(deviceId) || deviceId <= 0) return res.status(400).json({ ok: false, error: 'deviceId inválido.' }); if (!type || type.length > 80) return res.status(400).json({ ok: false, error: 'Tipo de comando inválido.' }); const attributes = body.attributes && typeof body.attributes === 'object' && !Array.isArray(body.attributes) ? body.attributes : {}; const command = { id: 0, deviceId, type, attributes }; const payload = await traccarFetch(req, '/api/commands/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) }); res.json({ ok: true, command: payload }); } catch (error) { res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao enviar comando.', details: error.payload || null }); } });
app.all('/api/traccar/*', requireAuth, async (req, res) => { try { if (!allowedMethods.has(req.method)) return res.status(405).json({ ok: false, error: 'Método não permitido.' }); const rawPath = `/${req.params[0] || ''}`.replace(/\/+/g, '/'); const apiPath = rawPath.startsWith('/api/') ? rawPath : `/api${rawPath}`; if (!isAllowedEndpoint(apiPath)) return res.status(403).json({ ok: false, error: 'Endpoint bloqueado pelo proxy seguro.', apiPath }); const query = new URLSearchParams(req.query).toString(); const finalPath = query ? `${apiPath}?${query}` : apiPath; const hasBody = !['GET', 'HEAD'].includes(req.method); const payload = await traccarFetch(req, finalPath, { method: req.method, headers: hasBody ? { 'Content-Type': 'application/json' } : {}, body: hasBody ? JSON.stringify(req.body || {}) : undefined }); res.set('Cache-Control', 'no-store'); res.json(payload); } catch (error) { res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao conectar ao Traccar.', details: error.payload || null }); } });
app.use(express.static(distDir, { etag: true, maxAge: '1h', setHeaders(res, filePath) { if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store'); } }));
app.get('*', (_req, res) => { res.sendFile(path.join(distDir, 'index.html')); });
app.use((error, _req, res, _next) => { console.error('[server]', error); res.status(500).json({ ok: false, error: 'Erro interno no proxy RAFACAR DEV2.' }); });
app.listen(config.port, '0.0.0.0', () => { console.log(`RAFACAR DEV2 rodando em 0.0.0.0:${config.port}`); console.log(`Proxy Traccar: ${config.traccarUrl}`); console.log('Auth mode: credenciais Traccar por usuário com cookie HttpOnly'); });
