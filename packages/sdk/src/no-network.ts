/*
 * Blocks every way this process could reach the network: fetch (and undici underneath it), http, https, net, tls,
 * http2, dgram and DNS lookups, plus the same in any worker thread started later. Import it first (the CLI and MCP bins do), or
 * preload it with `node --import @roundertools/sdk/no-network`. The packages have no network code; this is the belt
 * on top. Local IPC stays open (net sockets on a pipe or Unix socket path), since stdio transports and child
 * processes need it.
 */
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import { fileURLToPath, pathToFileURL } from 'node:url';
import worker_threads from 'node:worker_threads';

const MESSAGE = 'Network access is blocked: Rounder runs locally and never sends files anywhere.';

export class NetworkBlockedError extends Error {
  readonly code = 'ERR_ROUNDERTOOLS_NO_NETWORK';
  constructor(what: string) {
    super(`${MESSAGE} (${what})`);
    this.name = 'NetworkBlockedError';
  }
}

const deny = (what: string) =>
  function blocked(): never {
    throw new NetworkBlockedError(what);
  };

declare global {
  var __roundertoolsNoNetwork: boolean | undefined;
}

/** a connect() target that's a local pipe or Unix socket path, not a host */
const isLocalPath = (args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string' && !/^\d+$/.test(first)) return true;
  return typeof first === 'object' && first !== null && typeof (first as { path?: unknown }).path === 'string';
};

if (!globalThis.__roundertoolsNoNetwork) {
  globalThis.__roundertoolsNoNetwork = true;
  const blockedFetch = async (input: unknown) => {
    throw new NetworkBlockedError(`fetch ${typeof input === 'string' ? input : (input as URL)?.toString?.() ?? ''}`.trim());
  };
  Object.defineProperty(globalThis, 'fetch', { value: blockedFetch, writable: false, configurable: false });
  for (const name of ['WebSocket', 'EventSource'] as const) if (name in globalThis) Object.defineProperty(globalThis, name, { value: deny(name), writable: false, configurable: false });

  for (const [mod, label] of [[http, 'http'], [https, 'https']] as const) {
    mod.request = deny(`${label}.request`) as typeof mod.request;
    mod.get = deny(`${label}.get`) as typeof mod.get;
    mod.globalAgent?.destroy();
  }
  http2.connect = deny('http2.connect') as typeof http2.connect;
  tls.connect = deny('tls.connect') as typeof tls.connect;
  dgram.createSocket = deny('dgram.createSocket') as typeof dgram.createSocket;
  // a DNS query is traffic too (and can carry data out in the name it asks for)
  for (const api of [dns, dns.promises] as unknown as Record<string, unknown>[]) {
    for (const name of Object.keys(api)) if (name === 'lookup' || name === 'lookupService' || name.startsWith('resolve') || name === 'reverse') api[name] = deny(`dns.${name}`);
  }

  const connect = net.connect;
  const guarded = ((...args: unknown[]) => {
    if (!isLocalPath(args)) throw new NetworkBlockedError('net.connect');
    return (connect as (...a: unknown[]) => net.Socket)(...args);
  }) as typeof net.connect;
  net.connect = net.createConnection = guarded;
  const socketConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    if (!isLocalPath(args)) throw new NetworkBlockedError('net.Socket.connect');
    return (socketConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof socketConnect;

  // undici is what fetch runs on; a copy someone loads directly gets a dispatcher that refuses everything
  try {
    const require = createRequire(import.meta.url);
    const undici = require('undici') as { setGlobalDispatcher(d: unknown): void; Dispatcher: new () => object };
    class Refuse extends undici.Dispatcher {
      dispatch(): boolean {
        throw new NetworkBlockedError('undici');
      }
    }
    undici.setGlobalDispatcher(new Refuse());
  } catch {
    // undici isn't installed separately: Node's built-in fetch is already replaced above
  }

  // worker threads start with a fresh global (and ignore --import in execArgv): each one loads this file first.
  // Eval'd worker code is CommonJS unless the process runs with --input-type=module, which workers inherit.
  const path = JSON.stringify(fileURLToPath(import.meta.url));
  const href = JSON.stringify(import.meta.url);
  const Base = worker_threads.Worker;
  class GuardedWorker extends Base {
    constructor(filename: string | URL, options: worker_threads.WorkerOptions = {}) {
      const esm = (options.execArgv ?? process.execArgv).some((a) => a === '--input-type=module');
      const first = esm ? `import ${href};\n` : `require(${path});\n`;
      if (options.eval) super(`${first}${String(filename)}`, options);
      else {
        const url = filename instanceof URL ? filename.href : /^[a-z]+:/i.test(filename) && !/^[a-z]:[\\/]/i.test(filename) ? filename : pathToFileURL(filename).href;
        super(`${first}import(${JSON.stringify(url)});`, { ...options, eval: true });
      }
    }
  }
  worker_threads.Worker = GuardedWorker as typeof Base;
  // named ESM imports of these built-ins (import { request } from 'node:http') see the patched versions too
  syncBuiltinESMExports();
}

export const networkBlocked = () => globalThis.__roundertoolsNoNetwork === true;
