import { useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat, getToolApproval } from "@cloudflare/ai-chat/react";

const SUGGESTIONS = [
  {
    title: "Check on India",
    text: "Any internet outages in India this week?",
    category: "OUTAGE REPORT",
  },
  {
    title: "Make it personal",
    text: "Remember that I care about India",
    category: "YOUR ASSISTANT",
  },
  {
    title: "Stay in the loop",
    text: "Watch IN for outages every day",
    category: "DAILY WATCH",
  },
];

export default function App() {
  const [input, setInput] = useState("");
  const [userId] = useState(() => {
    let id = localStorage.getItem("outage-agent-id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("outage-agent-id", id);
    }
    return id;
  });
  const agent = useAgent({ agent: "OutageAgent", name: userId });
  const { messages, sendMessage, clearHistory, addToolApprovalResponse, status } = useAgentChat({ agent });
  const busy = status === "streaming" || status === "submitted";

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text });
    setInput("");
  };

  return (
    <main className="app">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Outage Agent home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand-name">signal<span>desk</span></span>
        </a>
        <div className="topbar-right">
          <span className="radar-label"><span className="status-dot" /> CLOUDFLARE RADAR</span>
          <button className="clear-button" onClick={clearHistory} disabled={messages.length === 0}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2m2 0-.7 10H6.7L6 6m2.5 3v4m3-4v4" /></svg>
            Clear chat
          </button>
        </div>
      </header>

      <section className="chat-shell" aria-label="Outage Agent chat">
        <div className="log" aria-live="polite">
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-icon" aria-hidden="true">
                <svg viewBox="0 0 48 48"><path d="M7 29a17 17 0 0 1 34 0M13 29a11 11 0 0 1 22 0M19 29a5 5 0 0 1 10 0" /><circle cx="24" cy="35" r="2" /></svg>
              </div>
              <p className="eyebrow">YOUR INTERNET, AT A GLANCE</p>
              <h1>Know when the<br /><span>internet goes quiet.</span></h1>
              <p className="welcome-copy">Ask about outages around the world, get a clear picture, and keep an eye on the places that matter to you.</p>
              <div className="suggestions-heading"><span>GOOD PLACE TO START</span><span className="suggestion-rule" /></div>
              <div className="suggestions">
                {SUGGESTIONS.map(({ title, text, category }, index) => (
                  <button key={text} className="suggestion-card" onClick={() => send(text)} disabled={busy}>
                    <span className={`suggestion-icon suggestion-icon-${index}`} aria-hidden="true">
                      {index === 0 ? (
                        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M3.8 9h16.4M3.8 15h16.4M12 3.5c2.1 2.3 3.1 5.1 3.1 8.5s-1 6.2-3.1 8.5C9.9 18.2 8.9 15.4 8.9 12s1-6.2 3.1-8.5Z" /></svg>
                      ) : index === 1 ? (
                        <svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.4-7.5-10a4.2 4.2 0 0 1 7.5-2.6A4.2 4.2 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10Z" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.2 2" /></svg>
                      )}
                    </span>
                    <span className="suggestion-content">
                      <span className="suggestion-category">{category}</span>
                      <span className="suggestion-title">{title}</span>
                      <span className="suggestion-prompt">{text}</span>
                    </span>
                    <span className="suggestion-arrow" aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
              <p className="data-note"><span aria-hidden="true">✳</span> Outage insights backed by Cloudflare Radar data</p>
            </div>
          ) : (
            <div className="conversation">
              {messages.map((m) => (
                <div key={m.id} className={`message-row ${m.role}`}>
                  {m.role === "assistant" && (
                    <span className="avatar" aria-label="Signal Desk">
                      <span /><span /><span />
                    </span>
                  )}
                  <div className={`msg ${m.role}`}>
                    {m.parts.map((part: any, i: number) => {
                      if (part.type === "text") return <p key={i}>{part.text}</p>;
                      if (part.state === "approval-requested") {
                        const approval = getToolApproval(part);
                        if (!approval) return null;
                        return (
                          <div key={i} className="approval">
                            <p>Approve <strong>{part.type.replace("tool-", "")}</strong>?</p>
                            <pre>{JSON.stringify(part.input, null, 2)}</pre>
                            <div className="approval-actions">
                              <button onClick={() => addToolApprovalResponse({ id: approval.id, approved: true })}>Approve</button>
                              <button className="secondary-button" onClick={() => addToolApprovalResponse({ id: approval.id, approved: false })}>Reject</button>
                            </div>
                          </div>
                        );
                      }
                      if (part.state === "output-available") {
                        return (
                          <details key={i} className="tool-result">
                            <summary>{part.type.replace("tool-", "")} · {JSON.stringify(part.input)}</summary>
                            <pre>{JSON.stringify(part.output, null, 2)}</pre>
                          </details>
                        );
                      }
                      return null;
                    })}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="message-row assistant">
                  <span className="avatar" aria-hidden="true"><span /><span /><span /></span>
                  <div className="typing-indicator" role="status"><span /><span /><span /><span className="sr-only">Assistant is responding</span></div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="composer-wrap">
          <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about outages, a country, or your connection…"
              aria-label="Message Signal Desk"
            />
            <button className="send-button" type="submit" disabled={busy || !input.trim()} aria-label={busy ? "Sending message" : "Send message"}>
              {busy ? <span className="send-spinner" /> : (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
              )}
            </button>
          </form>
          <p className="composer-caption">Clear answers, grounded in real outage data.</p>
        </div>
      </section>
    </main>
  );
}
