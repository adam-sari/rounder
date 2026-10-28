// first: nothing in this process may open a network connection
import '@roundertools/sdk/no-network';

// stdout is the MCP protocol stream; anything a library logs goes to stderr instead
console.log = console.info = console.debug = console.warn = console.error;

const { main } = await import('./main');
try {
  await main(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`roundertools-mcp: ${(e as Error)?.message ?? e}\n`);
  process.exitCode = 2;
}
