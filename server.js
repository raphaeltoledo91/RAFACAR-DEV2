import fs from 'node:fs';
import path from 'node:path';
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
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`[config] Falha ao ler ${file}:`, error.message);
    return fallback;
  }
}

function ensureConfigFile() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(configFile)) {
    const example = fs.existsSync(configExampleFile)
      ? fs.readFileSync(configExampleFile, 'utf8')
      : JSON.stringify({ traccarUrl: 'https://gps2.rafacarrastreadores.com.br', port: 3000, pollingMs: 30000 }, null, 2);
    fs.writeFileSync(configFile, example, { mode: 0o600 });
  }
  try { fs.chmodSync(configFile, 0o600); } catch { /* ignore chmod on unsupported fs */ }
}

ensureConfigFile();
const localConfig = readJsonSafe(configFile, {});

const config = {
  port: Number(process.env.PORT || localConfig.port || 3000),
  traccarUrl: String(process.env.TRACCAR_URL || localConfig.traccarUrl || 'https://gps2.rafacarrastreadores.com.br').replace(/\/+$/, ''),
  pollingMs: Number(process.env.POLLING_MS || localConfig.pollingMs || 30000),
  authMode: String(process.env.TRACCAR_AUTH_MODE || localConfig.authMode || 'token-session-cookie').toLowerCase(),
  user: process.env.TRACCAR_USER || localConfig.user || '',
  password: process.env.TRACCAR_PASSWORD || localConfig.password || '',
  token: process.env.TRACCAR_TOKEN || localConfig.token || '',
  tokenHeader: process.env.TRACCAR_TOKEN_HEADER || localConfig.tokenHeader || 'Authorization',
  tokenPrefix: process.env.TRACCAR_TOKEN_PREFIX ?? localConfig.tokenPrefix ?? 'Bearer ',
  allowUnsafeGoogleTiles: String(process.env.ALLOW_UNSAFE_GOOGLE_TILES ?? localConfig.allowUnsafeGoogleTiles ?? 'true') !== 'false'
};

const app = express();
const allowedMethods = new Set(['GET', 'POST', 'PUT', 'DELETE']);
const endpointAllowList = [
  /^\/api\/server$/,
  /^\/api\/session$/,
  /^\/api\/devices(?:\/\d+)?$/,
  /^\/api\/positions$/,
  /^\/api\/events$/,
  /^\/api\/reports\/(events|route|trips|stops|summary)$/,
  /^\/api\/commands(?:\/\d+)?$/,
  /^\/api\/commands\/(types|send)$/,
  /^\/api\/geofences(?:\/\d+)?$/,
  /^\/api\/groups(?:\/\d+)?$/,
  /^\/api\/drivers(?:\/\d+)?$/,
  /^\/api\/notifications(?:\/types)?$/,
  /^\/api\/maintenance(?:\/\d+)?$/
];

let remoteCookie = '';
let remoteCookieAt = 0;
const COOKIE_TTL_MS = 1000 * 60 * 25;

function isAllowedEndpoint(urlPath) {
  return endpointAllowList.some((rx) => rx.test(urlPath));
}

function safePublicConfig() {
  return {
    pollingMs: config.pollingMs,
    traccarUrl: config.traccarUrl,
    authMode: config.authMode,
    hasCredentials: Boolean((config.user && config.password) || config.token || remoteCookie),
    configExists: fs.existsSync(configFile),
    allowUnsafeGoogleTiles: config.allowUnsafeGoogleTiles
  };
}

function redact(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 8) return '********';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function parseSetCookie(headers) {
  const raw = headers.get('set-cookie');
  if (!raw) return '';
  return raw
    .split(/,(?=[^;,]+=)/g)
    .map((part) => part.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

function buildAuthHeaders(extra = {}) {
  const headers = {
    Accept: 'application/json',
    ...extra
  };

  if (config.authMode === 'bearer' && config.token) {
    headers[config.tokenHeader] = `${config.tokenPrefix || ''}${config.token}`;
  }

  if (config.authMode === 'basic' && config.user && config.password) {
    headers.Authorization = `Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}`;
  }

  if ((config.authMode === 'session-cookie' || config.authMode === 'token-session-cookie') && remoteCookie) {
    headers.Cookie = remoteCookie;
  }

  return headers;
}

async function createSessionCookie() {
  if (!['session-cookie', 'token-session-cookie'].includes(config.authMode)) return '';
  if (remoteCookie && Date.now() - remoteCookieAt < COOKIE_TTL_MS) return remoteCookie;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    let response;

    if (config.authMode === 'token-session-cookie' && config.token) {
      const url = `${config.traccarUrl}/api/session?token=${encodeURIComponent(config.token)}`;
      response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        redirect: 'manual'
      });
    } else if (config.user && config.password) {
      const body = new URLSearchParams({ email: config.user, password: config.password });
      response = await fetch(`${config.traccarUrl}/api/session`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body,
        signal: controller.signal,
        redirect: 'manual'
      });
    } else {
      return '';
    }

    const cookie = parseSetCookie(response.headers);
    if (response.ok && cookie) {
      remoteCookie = cookie;
      remoteCookieAt = Date.now();
      return remoteCookie;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`[auth] Falha ao criar sessão Traccar: HTTP ${response.status}`, text.slice(0, 200));
    }

    return remoteCookie;
  } finally {
    clearTimeout(timeout);
  }
}

async function traccarFetch(apiPath, options = {}) {
  if (!apiPath.startsWith('/api/')) {
    throw new Error('Caminho interno inválido para proxy Traccar.');
  }

  if (['session-cookie', 'token-session-cookie'].includes(config.authMode)) {
    await createSessionCookie();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 18000));
  const url = `${config.traccarUrl}${apiPath}`;

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: buildAuthHeaders(options.headers),
      body: options.body,
      signal: controller.signal,
      redirect: 'manual'
    });

    const setCookie = parseSetCookie(response.headers);
    if (setCookie) {
      remoteCookie = setCookie;
      remoteCookieAt = Date.now();
    }

    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    let payload = null;

    if (contentType.includes('application/json')) {
      try { payload = text ? JSON.parse(text) : null; }
      catch { payload = { raw: text }; }
    } else {
      payload = text ? { raw: text } : null;
    }

    if (response.status === 401 && ['session-cookie', 'token-session-cookie'].includes(config.authMode)) {
      remoteCookie = '';
      remoteCookieAt = 0;
    }

    if (!response.ok) {
      const message = payload?.message || payload?.error || payload?.raw || `Traccar retornou HTTP ${response.status}`;
      const error = new Error(String(message).slice(0, 500));
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Tempo esgotado ao conectar ao Traccar.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function recentIso(hoursBack = 24) {
  return new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

async function buildSnapshot() {
  const eventsPath = `/api/reports/events?from=${encodeURIComponent(recentIso(24))}&to=${encodeURIComponent(nowIso())}`;
  const [server, devices, positions, events] = await Promise.allSettled([
    traccarFetch('/api/server'),
    traccarFetch('/api/devices'),
    traccarFetch('/api/positions'),
    traccarFetch(eventsPath)
  ]);

  return {
    ok: true,
    server: server.status === 'fulfilled' ? server.value : null,
    devices: devices.status === 'fulfilled' && Array.isArray(devices.value) ? devices.value : [],
    positions: positions.status === 'fulfilled' && Array.isArray(positions.value) ? positions.value : [],
    events: events.status === 'fulfilled' && Array.isArray(events.value) ? events.value : [],
    errors: [server, devices, positions, events]
      .filter((item) => item.status === 'rejected')
      .map((item) => item.reason?.message || String(item.reason)),
    config: safePublicConfig()
  };
}

app.disable('x-powered-by');
app.set('trust proxy', 1);

const connectSrc = ["'self'", 'https://*.tile.openstreetmap.org', 'https://*.basemaps.cartocdn.com', 'https://server.arcgisonline.com'];
const imgSrc = ["'self'", 'data:', 'blob:', 'https:'];
if (config.allowUnsafeGoogleTiles) {
  connectSrc.push('https://mt0.google.com', 'https://mt1.google.com', 'https://mt2.google.com', 'https://mt3.google.com');
}

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "connect-src": connectSrc,
      "img-src": imgSrc,
      "style-src": ["'self'", "'unsafe-inline'", 'https:'],
      "script-src": ["'self'"],
      "font-src": ["'self'", 'data:'],
      "object-src": ["'none'"],
      "base-uri": ["'self'"]
    }
  }
}));
app.use(compression());
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: false, limit: '512kb' }));
app.use(morgan('combined'));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: 'draft-8',
  legacyHeaders: false
});
app.use('/api', apiLimiter);

app.get('/api/health', async (_req, res) => {
  const cookieBefore = remoteCookie;
  try { await createSessionCookie(); } catch (error) { console.error('[health/auth]', error.message); }
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    service: 'traccar-dev-final',
    version: '5.1.0',
    port: config.port,
    traccarUrl: config.traccarUrl,
    authMode: config.authMode,
    hasCredentials: Boolean((config.user && config.password) || config.token || remoteCookie),
    hasRemoteCookie: Boolean(remoteCookie),
    cookieChanged: Boolean(cookieBefore !== remoteCookie && remoteCookie),
    configExists: fs.existsSync(configFile),
    configFile,
    user: redact(config.user),
    token: redact(config.token)
  });
});

app.get('/api/config', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, config: safePublicConfig() });
});

app.get('/api/bootstrap', async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await buildSnapshot());
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message || 'Falha ao carregar dados iniciais.' });
  }
});

app.get('/api/snapshot', async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await buildSnapshot());
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message || 'Falha ao atualizar dados.' });
  }
});

app.get('/api/command-types', async (req, res) => {
  try {
    const deviceId = Number(req.query.deviceId);
    const query = Number.isFinite(deviceId) && deviceId > 0 ? `?deviceId=${deviceId}` : '';
    const payload = await traccarFetch(`/api/commands/types${query}`);
    res.set('Cache-Control', 'no-store');
    res.json(Array.isArray(payload) ? payload : []);
  } catch (error) {
    res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao carregar comandos.' });
  }
});

app.post('/api/send-command', async (req, res) => {
  try {
    const body = req.body || {};
    const deviceId = Number(body.deviceId);
    const type = String(body.type || '').trim();
    if (!Number.isFinite(deviceId) || deviceId <= 0) {
      return res.status(400).json({ ok: false, error: 'deviceId inválido.' });
    }
    if (!type || type.length > 80) {
      return res.status(400).json({ ok: false, error: 'Tipo de comando inválido.' });
    }

    const attributes = body.attributes && typeof body.attributes === 'object' && !Array.isArray(body.attributes)
      ? body.attributes
      : {};
    const command = { id: 0, deviceId, type, attributes };
    const payload = await traccarFetch('/api/commands/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command)
    });

    res.json({ ok: true, command: payload });
  } catch (error) {
    res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao enviar comando.', details: error.payload || null });
  }
});

app.all('/api/traccar/*', async (req, res) => {
  try {
    if (!allowedMethods.has(req.method)) {
      return res.status(405).json({ ok: false, error: 'Método não permitido.' });
    }

    const rawPath = `/${req.params[0] || ''}`.replace(/\/+/g, '/');
    const apiPath = rawPath.startsWith('/api/') ? rawPath : `/api${rawPath}`;
    if (!isAllowedEndpoint(apiPath)) {
      return res.status(403).json({ ok: false, error: 'Endpoint bloqueado pelo proxy seguro.', apiPath });
    }

    const query = new URLSearchParams(req.query).toString();
    const finalPath = query ? `${apiPath}?${query}` : apiPath;
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const payload = await traccarFetch(finalPath, {
      method: req.method,
      headers: hasBody ? { 'Content-Type': 'application/json' } : {},
      body: hasBody ? JSON.stringify(req.body || {}) : undefined
    });

    res.set('Cache-Control', 'no-store');
    res.json(payload);
  } catch (error) {
    res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao conectar ao Traccar.', details: error.payload || null });
  }
});

app.use(express.static(distDir, {
  etag: true,
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error('[server]', error);
  res.status(500).json({ ok: false, error: 'Erro interno no proxy do TRACCAR DEV.' });
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`TRACCAR DEV final rodando em 0.0.0.0:${config.port}`);
  console.log(`Proxy Traccar: ${config.traccarUrl}`);
  console.log(`Auth mode: ${config.authMode}`);
});
