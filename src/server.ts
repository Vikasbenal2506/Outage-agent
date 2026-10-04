import { AIChatAgent } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, convertToModelMessages, pruneMessages, tool, stepCountIs } from "ai";
import { z } from "zod";
import { SYSTEM_PROMPT } from "./prompts";
import { fetchOutages, summarize } from "./tools/radar";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Workers AI sometimes streams delta.content as a number; the AI SDK requires a string.
function fixStream(res: Response): Response {
  if (!res.body || !res.headers.get("content-type")?.includes("text/event-stream")) return res;
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";

  const fixLine = (line: string) => {
    if (!line.startsWith("data:")) return line;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return line;
    try {
      const obj = JSON.parse(payload);
      for (const c of obj.choices ?? []) {
        if (c.delta && typeof c.delta.content === "number") c.delta.content = String(c.delta.content);
      }
      return "data: " + JSON.stringify(obj);
    } catch {
      return line;
    }
  };

  const ts = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      if (lines.length) ctrl.enqueue(enc.encode(lines.map(fixLine).join("\n") + "\n"));
    },
    flush(ctrl) {
      if (buf) ctrl.enqueue(enc.encode(fixLine(buf)));
    },
  });

  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(res.body.pipeThrough(ts), { status: res.status, statusText: res.statusText, headers });
}

// Workers AI's chat endpoint wants string content, and null content on tool-call messages.
const normalizeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  console.log("[normalizeFetch] called, body type:", typeof init?.body);
  if (typeof init?.body === "string") {
    try {
      const body = JSON.parse(init.body);
      if (Array.isArray(body.messages)) {
        body.messages = body.messages.map((m: any) => {
          if (Array.isArray(m.content)) {
            m = { ...m, content: m.content.map((p: any) => p.text ?? "").join("") };
          }
          if (m.role === "assistant" && m.content == null) {
            m = { ...m, content: "" };
          }
          return m;
        });
        console.log("[normalizeFetch] sending:", JSON.stringify(body.messages.map((m: any) => [m.role, typeof m.content])));
        init = { ...init, body: JSON.stringify(body) };
      }
    } catch (e) {
      console.error("[normalizeFetch] rewrite failed:", e);
    }
  }
  return fixStream(await fetch(input, init));
}) as typeof fetch;

export type AgentState = {
  notes: string[];
  watches: string[];
  scheduled: boolean;
  alerts: { country: string; checkedAt: string; summary: string }[];
};

export class OutageAgent extends AIChatAgent<
  Env & { CF_API_TOKEN: string; AI_API_TOKEN: string; CF_ACCOUNT_ID: string },
  AgentState
> {
  initialState: AgentState = { notes: [], watches: [], scheduled: false, alerts: [] };

  // Runs on the daily schedule: re-check every watched country.
  async checkWatches() {
    const alerts: AgentState["alerts"] = [];
    for (const country of this.state.watches) {
      let summary: string;
      try {
        summary = summarize(await fetchOutages(this.env.CF_API_TOKEN, country, 1));
      } catch (e) {
        summary = `Check failed: ${(e as Error).message}`;
      }
      alerts.push({ country, checkedAt: new Date().toISOString(), summary });
    }
    this.setState({ ...this.state, alerts });
  }

  async onChatMessage() {
    console.log("[agent] onChatMessage, messages:", this.messages.length);
    const workersai = createOpenAICompatible({
      name: "workers-ai",
      baseURL: `https://api.cloudflare.com/client/v4/accounts/${this.env.CF_ACCOUNT_ID}/ai/v1`,
      headers: { Authorization: `Bearer ${this.env.AI_API_TOKEN}` },
      fetch: normalizeFetch,
    });
    const { notes, watches, alerts } = this.state;

    const result = streamText({
      model: workersai(MODEL),
      system: `${SYSTEM_PROMPT}\n\nUser notes: ${JSON.stringify(notes)}\nWatched: ${JSON.stringify(watches)}\nLatest watch results: ${JSON.stringify(alerts)}`,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
      }),
      tools: {
        getInternetOutages: tool({
          description: "Recent internet outages for a country from Cloudflare Radar.",
          inputSchema: z.object({
            country: z.string().length(2).describe("ISO alpha-2 code, e.g. IN, US, IQ"),
            days: z.number().min(1).max(90).default(30),
          }),
          execute: async ({ country, days }) => {
            console.log("[tool] getInternetOutages", country, days);
            try {
              const outages = await fetchOutages(this.env.CF_API_TOKEN, country, days);
              return { country, days, count: outages.length, outages };
            } catch (e) {
              return { error: (e as Error).message };
            }
          },
        }),
        remember: tool({
          description: "Save a fact about the user for future conversations.",
          inputSchema: z.object({ fact: z.string().max(200) }),
          execute: async ({ fact }) => {
            this.setState({ ...this.state, notes: [...this.state.notes, fact].slice(-20) });
            return { saved: fact };
          },
        }),
        watchCountry: tool({
          description: "Monitor a country daily for outages. Needs user approval.",
          inputSchema: z.object({ country: z.string().length(2) }),
          needsApproval: async () => true,
          execute: async ({ country }) => {
            const code = country.toUpperCase();
            const watches = Array.from(new Set([...this.state.watches, code]));
            let scheduled = this.state.scheduled;
            if (!scheduled) {
              await this.schedule("0 8 * * *", "checkWatches"); // daily 08:00 UTC
              scheduled = true;
            }
            this.setState({ ...this.state, watches, scheduled });
            return { watching: watches };
          },
        }),
      },
      onError: ({ error }) => console.error("[streamText] error:", error),
      stopWhen: stepCountIs(3),
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (await routeAgentRequest(request, env)) || new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;