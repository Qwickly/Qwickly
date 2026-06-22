import net from "node:net";

const rawPort = process.argv[2];
const host = process.argv[3] ?? "127.0.0.1";
const timeoutMs = Number(process.argv[4] ?? "30000");
const retryDelayMs = 250;

if (!rawPort) {
  console.error("Usage: node scripts/wait-for-port.mjs <port> [host] [timeoutMs]");
  process.exit(1);
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  console.error(`Invalid port: ${rawPort}`);
  process.exit(1);
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function canConnect() {
  await new Promise((resolve, reject) => {
    const socket = new net.Socket();

    socket.setTimeout(1000);

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("Timed out"));
    });

    socket.once("error", (error) => {
      socket.destroy();
      reject(error);
    });

    socket.connect(port, host);
  });
}

const start = Date.now();

while (Date.now() - start < timeoutMs) {
  try {
    await canConnect();
    console.log(`Port ${port} is ready on ${host}`);
    process.exit(0);
  } catch {
    await wait(retryDelayMs);
  }
}

console.error(`Timed out waiting for ${host}:${port} after ${timeoutMs}ms`);
process.exit(1);
