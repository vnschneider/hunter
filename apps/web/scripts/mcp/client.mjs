import { spawn } from "child_process";

export class HunterMcpClient {
  constructor({
    command = "node",
    args = ["scripts/mcp/hunter-mcp-server.mjs"],
    requestTimeoutMs = Number(process.env.MCP_REQUEST_TIMEOUT_MS ?? "120000"),
    initializeTimeoutMs = Number(
      process.env.MCP_INITIALIZE_TIMEOUT_MS ?? "20000",
    ),
  } = {}) {
    this.command = command;
    this.args = args;
    this.requestTimeoutMs = requestTimeoutMs;
    this.initializeTimeoutMs = initializeTimeoutMs;
    this.proc = null;
    this.buffer = Buffer.alloc(0);
    this.id = 1;
    this.pending = new Map();
  }

  async start() {
    if (this.proc) return;

    this.proc = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });

    this.proc.stdout.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
      this.#processBuffer();
    });

    this.proc.stderr.on("data", () => {
      // stderr mantido para debug local quando necessário
    });

    this.proc.on("exit", (code) => {
      for (const [, p] of this.pending) {
        p.reject(new Error(`MCP process exited with code ${code}`));
      }
      this.pending.clear();
      this.proc = null;
    });

    await this.request(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        clientInfo: {
          name: "hunter-worker",
          version: "0.1.0",
        },
        capabilities: {},
      },
      this.initializeTimeoutMs,
    );
  }

  async stop() {
    if (!this.proc) return;
    this.proc.kill();
    this.proc = null;
  }

  async request(method, params = {}, timeoutMs = this.requestTimeoutMs) {
    if (!this.proc) {
      throw new Error("MCP client not started");
    }

    const id = this.id++;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const json = JSON.stringify(payload);
    const msg = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;

    const responsePromise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(
            new Error(`MCP timeout for method ${method} after ${timeoutMs}ms`),
          );
        }
      }, timeoutMs);
    });

    this.proc.stdin.write(msg);
    return responsePromise;
  }

  async callTool(name, args = {}, timeoutMs = this.requestTimeoutMs) {
    const result = await this.request(
      "tools/call",
      {
        name,
        arguments: args,
      },
      timeoutMs,
    );

    const text = result?.content?.[0]?.text;
    if (!text) return null;
    return JSON.parse(text);
  }

  #processBuffer() {
    const separator = Buffer.from("\r\n\r\n", "utf8");

    while (true) {
      const headerEnd = this.buffer.indexOf(separator);
      if (headerEnd === -1) return;

      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = Buffer.alloc(0);
        return;
      }

      const contentLength = Number(match[1]);
      const start = headerEnd + separator.length;
      if (this.buffer.length < start + contentLength) return;

      const payload = this.buffer
        .slice(start, start + contentLength)
        .toString("utf8");
      this.buffer = this.buffer.slice(start + contentLength);

      let message;
      try {
        message = JSON.parse(payload);
      } catch {
        continue;
      }

      if (!Object.prototype.hasOwnProperty.call(message, "id")) continue;

      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(new Error(message.error.message ?? "MCP error"));
      } else {
        pending.resolve(message.result);
      }
    }
  }
}
