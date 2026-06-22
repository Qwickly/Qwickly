import { execSync } from "node:child_process";

const ports = [8080, 23168];

if (process.platform === "win32") {
  for (const port of ports) {
    try {
      const output = execSync(
        `netstat -ano | findstr :${port}`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] },
      );
      const pids = new Set(
        output
          .split("\n")
          .map((line) => line.trim().split(/\s+/).pop())
          .filter((pid) => pid && /^\d+$/.test(pid) && pid !== "0"),
      );
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
          console.log(`Freed port ${port} (PID ${pid})`);
        } catch {
          // process may have already exited
        }
      }
    } catch {
      // no process on this port
    }
  }
} else {
  for (const port of ports) {
    try {
      const output = execSync(`lsof -ti :${port}`, { encoding: "utf8" });
      for (const pid of output.trim().split("\n").filter(Boolean)) {
        process.kill(Number(pid));
        console.log(`Freed port ${port} (PID ${pid})`);
      }
    } catch {
      // no process on this port
    }
  }
}
