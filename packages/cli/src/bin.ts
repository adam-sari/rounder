// first, before anything that could open a socket
import '@roundertools/sdk/no-network';

// stdout carries results (and --json); a stray console.log from a library must not end up in it
console.log = console.error;

const controller = new AbortController();
let interrupted = false;
process.on('SIGINT', () => {
  // a second Ctrl+C quits at once
  if (interrupted) process.exit(130);
  interrupted = true;
  controller.abort();
});

// loaded after the guard: static imports could be hoisted above it
const { main } = await import('./main');
const code = await main(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin, cwd: process.cwd(), env: process.env, signal: controller.signal });
process.exitCode = code;
