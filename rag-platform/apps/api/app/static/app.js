(() => {
  const EXAMPLES = [
    "What caused the Kubernetes pod scheduling failures?",
    "How were the scheduling failures resolved?",
    "How should you manage the Python asyncio event loop?",
    "What is the recommended approach for aiohttp connection pooling?",
  ];

  const els = {
    welcome: document.getElementById("welcome"),
    thread: document.getElementById("thread"),
    form: document.getElementById("query-form"),
    question: document.getElementById("question"),
    askBtn: document.getElementById("ask-btn"),
    health: document.getElementById("health-pill"),
    settingsToggle: document.getElementById("settings-toggle"),
    settingsPanel: document.getElementById("settings-panel"),
    retrievalMode: document.getElementById("retrieval-mode"),
    topK: document.getElementById("top-k"),
    includeEval: document.getElementById("include-eval"),
    examples: document.getElementById("example-prompts"),
  };

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function formatMs(ms) {
    if (ms == null || Number.isNaN(ms)) return "—";
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
  }

  function scoreClass(score) {
    if (score == null) return "";
    if (score >= 0.7) return "good";
    if (score >= 0.4) return "warn";
    return "";
  }

  function setBusy(busy) {
    els.askBtn.disabled = busy;
    els.askBtn.classList.toggle("is-loading", busy);
    els.question.disabled = busy;
  }

  function showThread() {
    els.welcome.hidden = true;
    els.thread.hidden = false;
  }

  function resizeTextarea() {
    const el = els.question;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  function renderExamples() {
    els.examples.innerHTML = EXAMPLES.map(
      (q) =>
        `<button type="button" class="prompt-chip" role="listitem">${escapeHtml(q)}</button>`
    ).join("");

    els.examples.querySelectorAll(".prompt-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        els.question.value = btn.textContent;
        resizeTextarea();
        els.question.focus();
        els.form.requestSubmit();
      });
    });
  }

  function appendTurn(questionText) {
    showThread();
    const turn = document.createElement("article");
    turn.className = "turn";
    turn.innerHTML = `
      <div class="question-bubble">${escapeHtml(questionText)}</div>
      <div class="answer-slot"><p class="answer-text" style="opacity:0.65">Retrieving and generating…</p></div>
    `;
    els.thread.appendChild(turn);
    turn.scrollIntoView({ behavior: "smooth", block: "end" });
    return turn.querySelector(".answer-slot");
  }

  function renderAnswer(slot, data) {
    const citations = (data.citations || [])
      .map(
        (c) => `
        <div class="citation">
          <strong>[Source ${escapeHtml(c.source_index)}]</strong>
          ${escapeHtml(c.text_snippet || "")}
        </div>`
      )
      .join("");

    const latencies = data.layer_latencies_ms || {};
    const latencyBits = Object.entries(latencies)
      .map(([k, v]) => `${escapeHtml(k)} ${formatMs(v)}`)
      .join(" · ");

    let evalHtml = "";
    if (data.eval_scores && Object.keys(data.eval_scores).length) {
      evalHtml = `<div class="eval-row">${Object.entries(data.eval_scores)
        .map(([k, v]) => {
          const n = Number(v);
          const label = Number.isFinite(n) ? n.toFixed(2) : String(v);
          return `<span class="eval-pill ${scoreClass(n)}">${escapeHtml(k)} ${escapeHtml(label)}</span>`;
        })
        .join("")}</div>`;
    }

    slot.innerHTML = `
      <div class="answer-panel ${data.refused ? "refused" : ""}">
        <p class="answer-text">${escapeHtml(data.answer || "")}</p>
        ${citations ? `<div class="citations"><p class="citations-title">Sources</p>${citations}</div>` : ""}
        ${evalHtml}
        <div class="answer-meta">
          <span class="meta-chip">${formatMs(data.total_latency_ms)} total</span>
          <span class="meta-chip">${escapeHtml(data.model || "model")}</span>
          ${latencyBits ? `<span class="meta-chip">${latencyBits}</span>` : ""}
          ${data.trace_id ? `<span class="meta-chip">trace ${escapeHtml(data.trace_id.slice(0, 8))}</span>` : ""}
        </div>
      </div>
    `;
  }

  function renderError(slot, message) {
    slot.innerHTML = `<div class="error-banner">${escapeHtml(message)}</div>`;
  }

  async function checkHealth() {
    try {
      const res = await fetch("/query/health", { cache: "no-store" });
      const data = await res.json();
      const ready = data.status === "ready";
      els.health.dataset.state = ready ? "ready" : "degraded";
      els.health.textContent = ready ? "Pipeline ready" : "Pipeline degraded";
      if (!ready && data.error) {
        els.health.title = data.error;
      }
    } catch {
      els.health.dataset.state = "offline";
      els.health.textContent = "API offline";
    }
  }

  async function askQuestion(question) {
    const slot = appendTurn(question);
    setBusy(true);

    const payload = {
      question,
      retrieval_mode: els.retrievalMode.value,
      top_k: Number(els.topK.value) || 5,
      include_eval_scores: els.includeEval.checked,
    };

    try {
      const res = await fetch("/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        const detail = data && (data.detail || data.message);
        throw new Error(detail || `Request failed (${res.status})`);
      }

      renderAnswer(slot, data);
      checkHealth();
    } catch (err) {
      renderError(slot, err.message || "Something went wrong talking to the pipeline.");
    } finally {
      setBusy(false);
      els.question.focus();
    }
  }

  els.settingsToggle.addEventListener("click", () => {
    const open = els.settingsPanel.hasAttribute("hidden");
    if (open) {
      els.settingsPanel.removeAttribute("hidden");
    } else {
      els.settingsPanel.setAttribute("hidden", "");
    }
    els.settingsToggle.setAttribute("aria-expanded", String(open));
  });

  els.question.addEventListener("input", resizeTextarea);

  els.question.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      els.form.requestSubmit();
    }
  });

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = els.question.value.trim();
    if (!question || els.askBtn.disabled) return;
    els.question.value = "";
    resizeTextarea();
    askQuestion(question);
  });

  renderExamples();
  checkHealth();
  setInterval(checkHealth, 30000);
  els.question.focus();
})();
