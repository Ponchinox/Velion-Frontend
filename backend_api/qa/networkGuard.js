import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import child_process from 'node:child_process';
import path from 'node:path';

/**
 * Velion QA Network Guard (Versión Reforzada Adversarial)
 * ========================================================
 * Garantías absolutas de Costo S/0.00 y Aislamiento:
 * 1. Neutraliza credenciales de API externas (Gemini, Groq, Evolution, Meta, Stripe)
 *    reemplazándolas por dummies inofensivos.
 * 2. Bloquea todo intento de conexión TCP/TLS/HTTP/Fetch hacia la WAN.
 * 3. Bloquea terminantemente el acceso a PostgreSQL real (puerto 5432) en:
 *    - 127.0.0.1:5432
 *    - localhost:5432
 *    - [::1]:5432
 * 4. Intercepta child_process (spawn, exec, execFile) bloqueando binarios de red (curl, wget, ssh, etc.)
 *    para evitar escapes a nivel sistema operativo.
 * 5. Permite únicamente loopback local (127.0.0.1, localhost, ::1) en puertos efímeros para mock servers.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0', '']);
const BLOCKED_DB_PORTS = new Set([5432]);

export const networkGuardMetrics = {
  blockedWanCalls: 0,
  blockedDbCalls: 0,
  blockedSubprocesses: 0,
  allowedLoopbackCalls: 0,
  liveApiCalls: 0
};

export function isLoopback(host) {
  if (!host) return true;
  const clean = String(host).toLowerCase().trim().replace(/^\[|\]$/g, '');
  return LOOPBACK_HOSTS.has(clean);
}

export function checkTarget(host, port, transport = 'TCP') {
  if (isLoopback(host)) {
    if (BLOCKED_DB_PORTS.has(Number(port))) {
      networkGuardMetrics.blockedDbCalls++;
      throw new Error(`[FATAL_QA_DATABASE_ACCESS_VIOLATION] Real PostgreSQL access (host: '${host}', port: ${port}) is forbidden in QA_MODE! All QA tests must use mockPrisma in-memory.`);
    }
    networkGuardMetrics.allowedLoopbackCalls++;
    return; // Conexión local autorizada (mock server)
  }

  networkGuardMetrics.blockedWanCalls++;
  throw new Error(`[FATAL_QA_NETWORK_VIOLATION] Outbound ${transport} connection to '${host}:${port}' blocked in QA_MODE! External API calls are strictly forbidden (Estimated API Cost: S/0.00).`);
}

function extractTarget(args) {
  let first = args[0];
  if (Array.isArray(first)) {
    first = first[0];
  }
  let host = '127.0.0.1';
  let port = 0;

  if (typeof first === 'object' && first !== null) {
    host = first.host || first.hostname || first.servername || '127.0.0.1';
    port = first.port || 0;
  } else if (typeof first === 'number') {
    port = first;
    if (typeof args[1] === 'string') {
      host = args[1];
    }
  } else if (typeof first === 'string') {
    if (first.startsWith('/') || first.startsWith('\\\\')) {
      return { host: '127.0.0.1', port: 0, isIpc: true };
    }
    host = first;
    if (typeof args[1] === 'number') {
      port = args[1];
    }
  }
  return { host, port, isIpc: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. NEUTRALIZACIÓN DE VARIABLES DE ENTORNO
// ─────────────────────────────────────────────────────────────────────────────
export function neutralizeEnvironment() {
  process.env.QA_MODE = 'true';
  process.env.NODE_ENV = 'test';

  const externalKeys = [
    'GEMINI_API_KEY',
    'GEMINI_API_KEY_FALLBACK',
    'GROQ_API_KEY',
    'OPENAI_API_KEY',
    'EVOLUTION_API_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'META_API_TOKEN',
    'WHATSAPP_TOKEN',
    'FACEBOOK_APP_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET'
  ];

  for (const k of externalKeys) {
    process.env[k] = `MOCK_QA_BLOCKED_${k}`;
  }

  process.env.EVOLUTION_API_URL = 'http://127.0.0.1:9999/mock-evolution-blocked';
  process.env.DATABASE_URL = 'postgresql://mock_qa_blocked:mock_qa_blocked@127.0.0.1:9/mock_qa_db?schema=public';
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. INTERCEPCIÓN A NIVEL SOCKET (net.Socket, net.connect, tls.connect)
// ─────────────────────────────────────────────────────────────────────────────
const origSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const { host, port, isIpc } = extractTarget(args);
  if (!isIpc) {
    try {
      checkTarget(host, port, 'TCP');
    } catch (err) {
      this.destroy(err);
      this.emit('error', err);
      throw err;
    }
  }
  return origSocketConnect.apply(this, args);
};

const origNetConnect = net.connect;
net.connect = net.createConnection = function (...args) {
  const { host, port, isIpc } = extractTarget(args);
  if (!isIpc) {
    checkTarget(host, port, 'net.connect');
  }
  return origNetConnect.apply(this, args);
};

const origTlsConnect = tls.connect;
tls.connect = function (...args) {
  const { host, port, isIpc } = extractTarget(args);
  if (!isIpc) {
    checkTarget(host, port || 443, 'TLS');
  }
  return origTlsConnect.apply(this, args);
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. INTERCEPCIÓN HTTP, HTTPS Y FETCH
// ─────────────────────────────────────────────────────────────────────────────
const origHttpRequest = http.request;
http.request = function (...args) {
  const { host, port } = extractTarget(args);
  checkTarget(host, port || 80, 'HTTP');
  return origHttpRequest.apply(this, args);
};

const origHttpsRequest = https.request;
https.request = function (...args) {
  const { host, port } = extractTarget(args);
  checkTarget(host, port || 443, 'HTTPS');
  return origHttpsRequest.apply(this, args);
};

const origFetch = globalThis.fetch;
if (origFetch) {
  globalThis.fetch = async function (input, init) {
    let urlStr = typeof input === 'string' ? input : (input?.url || input?.href);
    if (urlStr) {
      const parsed = new URL(urlStr, 'http://127.0.0.1');
      checkTarget(parsed.hostname, parsed.port || (parsed.protocol === 'https:' ? 443 : 80), 'fetch');
    }
    return origFetch.call(this, input, init);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. PROTECCIÓN CONTRA ESCAPE VÍA SUBPROCESOS DEL SISTEMA OPERATIVO
// ─────────────────────────────────────────────────────────────────────────────
const BLOCKED_CLI_TOOLS = new Set([
  'curl', 'curl.exe',
  'wget', 'wget.exe',
  'ssh', 'ssh.exe',
  'scp', 'scp.exe',
  'sftp', 'sftp.exe',
  'nc', 'nc.exe', 'netcat', 'ncat',
  'telnet', 'telnet.exe'
]);

function inspectSubprocessCommand(cmd, args) {
  if (!cmd) return;
  const rawFirst = String(cmd).trim().split(/\s+/)[0];
  const base = path.basename(rawFirst).toLowerCase();
  if (BLOCKED_CLI_TOOLS.has(base)) {
    networkGuardMetrics.blockedSubprocesses++;
    throw new Error(`[FATAL_QA_NETWORK_VIOLATION] OS subprocess '${base}' with network capabilities is blocked in QA_MODE! Network escapes via CLI are strictly forbidden.`);
  }

  // Verificar si se invoca powershell / cmd con scripts de descarga
  const combined = [cmd, ...(Array.isArray(args) ? args : [])].join(' ').toLowerCase();
  if (
    combined.includes('invoke-webrequest') ||
    combined.includes('invoke-restmethod') ||
    combined.includes('downloadstring') ||
    combined.includes('downloadfile') ||
    combined.includes('system.net.webclient') ||
    combined.includes('system.net.sockets')
  ) {
    networkGuardMetrics.blockedSubprocesses++;
    throw new Error(`[FATAL_QA_NETWORK_VIOLATION] OS subprocess execution containing web download commands is blocked in QA_MODE!`);
  }
}

const origSpawn = child_process.spawn;
child_process.spawn = function (cmd, args, options) {
  inspectSubprocessCommand(cmd, args);
  return origSpawn.call(this, cmd, args, options);
};

const origSpawnSync = child_process.spawnSync;
child_process.spawnSync = function (cmd, args, options) {
  inspectSubprocessCommand(cmd, args);
  return origSpawnSync.call(this, cmd, args, options);
};

const origExec = child_process.exec;
child_process.exec = function (cmd, ...args) {
  inspectSubprocessCommand(cmd);
  return origExec.call(this, cmd, ...args);
};

const origExecSync = child_process.execSync;
child_process.execSync = function (cmd, ...args) {
  inspectSubprocessCommand(cmd);
  return origExecSync.call(this, cmd, ...args);
};

const origExecFile = child_process.execFile;
child_process.execFile = function (file, args, ...rest) {
  inspectSubprocessCommand(file, args);
  return origExecFile.call(this, file, args, ...rest);
};

const origExecFileSync = child_process.execFileSync;
child_process.execFileSync = function (file, args, ...rest) {
  inspectSubprocessCommand(file, args);
  return origExecFileSync.call(this, file, args, ...rest);
};

// Activar neutralización de variables al cargarse el módulo
neutralizeEnvironment();
