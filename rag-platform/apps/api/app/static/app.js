(() => {
  const EXAMPLES = [
    "What caused the Kubernetes pod scheduling failures?",
    "How were the scheduling failures resolved?",
    "How should you manage the Python asyncio event loop?",
    "What is the recommended approach for aiohttp connection pooling?",
  ];

  const STAGE_ORDER = ["retrieving", "reranking", "assembling", "generating", "scoring"];

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

  let busy = false;

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
    return "bad";
  }

  function formatAnswerHtml(text, citations) {
    const byIndex = {};
    (citations || []).forEach((c) => {
      byIndex[String(c.source_index)] = c;
    });
    let html = escapeHtml(text);
    html = html.replace(/\[([^\]]+)\]\((\/[^)\s]+)\)/g, (_, label, href) => {
      return `<a class="inline-link" href="${escapeHtml(href)}" target="_blank" rel="noopener">${label}</a>`;
    });
    html = html.replace(/\[Source\s+(\d+)\]/gi, (_, num) => {
      const cite = byIndex[num];
      if (cite && cite.url) {
        return `<a class="cite-chip" href="${escapeHtml(cite.url)}" target="_blank" rel="noopener" title="${escapeHtml(cite.title || "Open source")}">[Source ${escapeHtml(num)}]</a>`;
      }
      return `<span class="cite-chip">[Source ${escapeHtml(num)}]</span>`;
    });
    return html
      .replace(/^### (.+)$/gm, "<strong>$1</strong>")
      .replace(/^## (.+)$/gm, "<strong>$1</strong>")
      .replace(/^# (.+)$/gm, "<strong>$1</strong>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br>");
  }

  function qualityNote(scores) {
    if (!scores || !Object.keys(scores).length) return "";
    const quality = scores.answer_quality;
    const faith = scores.faithfulness;
    const rel = scores.answer_relevancy;
    if (quality == null) return "";
    if (quality >= 0.7) return "";
    if (faith != null && rel != null && faith >= 0.7 && rel < 0.4) {
      return `<p class="quality-note">Grounded in sources, but weakly matched to your question (relevancy ${Number(rel).toFixed(2)}).</p>`;
    }
    if (quality < 0.4) {
      return `<p class="quality-note">Low answer quality (${Number(quality).toFixed(2)}). Prefer a more specific indexed topic.</p>`;
    }
    return "";
  }

  function setBusy(isBusy) {
    busy = isBusy;
    els.askBtn.disabled = isBusy;
    els.askBtn.classList.toggle("is-loading", isBusy);
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
        if (busy) return;
        els.question.value = btn.textContent;
        resizeTextarea();
        els.question.focus();
        els.form.requestSubmit();
      });
    });
  }

  function renderCitations(citations) {
    if (!citations || !citations.length) return "";
    const items = citations
      .map((c) => {
        const title = c.title || `Source ${c.source_index}`;
        const link = c.url
          ? `<a class="source-link" href="${escapeHtml(c.url)}" target="_blank" rel="noopener">Open full document →</a>`
          : "";
        return `
        <div class="citation">
          <div class="citation-head">
            <strong>[Source ${escapeHtml(c.source_index)}]</strong>
            <span>${escapeHtml(title)}</span>
          </div>
          <p class="citation-snippet">${escapeHtml(c.text_snippet || "")}</p>
          ${link}
        </div>`;
      })
      .join("");
    return `<div class="citations"><p class="citations-title">Sources</p>${items}</div>`;
  }

  function renderAnswerMeta(data) {
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
          const invert = k === "hallucination_rate";
          const klass = invert ? scoreClass(1 - (Number.isFinite(n) ? n : 0)) : scoreClass(n);
          return `<span class="eval-pill ${klass}">${escapeHtml(k)} ${escapeHtml(label)}</span>`;
        })
        .join("")}</div>`;
    }
    return `
      ${qualityNote(data.eval_scores)}
      ${renderCitations(data.citations)}
      ${evalHtml}
      <div class="answer-meta">
        <span class="meta-chip">${formatMs(data.total_latency_ms)} total</span>
        <span class="meta-chip">${escapeHtml(data.model || "model")}</span>
        ${latencyBits ? `<span class="meta-chip">${latencyBits}</span>` : ""}
        ${data.trace_id ? `<span class="meta-chip">trace ${escapeHtml(String(data.trace_id).slice(0, 8))}</span>` : ""}
      </div>`;
  }

  function createLivePanel(questionText) {
    showThread();
    const turn = document.createElement("article");
    turn.className = "turn";
    turn.innerHTML = `
      <div class="question-bubble">${escapeHtml(questionText)}</div>
      <div class="answer-slot">
        <div class="answer-panel is-streaming">
          <div class="progress-rail" aria-hidden="true">
            <div class="progress-bar"></div>
          </div>
          <div class="stage-row">
            <span class="stage-dot"></span>
            <span class="stage-label">Starting…</span>
            <span class="stage-timer">0.0s</span>
          </div>
          <div class="stage-steps"></div>
          <div class="answer-text live-answer"><span class="cursor" aria-hidden="true"></span></div>
          <div class="stream-footer"></div>
        </div>
      </div>
    `;
    els.thread.appendChild(turn);
    turn.scrollIntoView({ behavior: "smooth", block: "end" });

    const panel = turn.querySelector(".answer-panel");
    const label = turn.querySelector(".stage-label");
    const timer = turn.querySelector(".stage-timer");
    const steps = turn.querySelector(".stage-steps");
    const live = turn.querySelector(".live-answer");
    const footer = turn.querySelector(".stream-footer");
    const bar = turn.querySelector(".progress-bar");
    const started = performance.now();

    const timerId = setInterval(() => {
      const secs = (performance.now() - started) / 1000;
      timer.textContent = `${secs.toFixed(1)}s`;
    }, 100);

    function setStage(stage, text) {
      label.textContent = text || stage;
      const idx = STAGE_ORDER.indexOf(stage);
      if (idx >= 0) {
        bar.style.width = `${Math.min(92, 18 + idx * 18)}%`;
      }
      if (stage && !steps.querySelector(`[data-stage="${stage}"]`)) {
        const chip = document.createElement("span");
        chip.className = "stage-chip is-active";
        chip.dataset.stage = stage;
        chip.textContent = text || stage;
        steps.querySelectorAll(".stage-chip").forEach((c) => c.classList.remove("is-active"));
        steps.appendChild(chip);
      } else if (stage) {
        steps.querySelectorAll(".stage-chip").forEach((c) => {
          c.classList.toggle("is-active", c.dataset.stage === stage);
        });
      }
    }

    let raw = "";
    function appendToken(text) {
      raw += text;
      live.innerHTML = `${formatAnswerHtml(raw, [])}<span class="cursor" aria-hidden="true"></span>`;
      turn.scrollIntoView({ behavior: "smooth", block: "end" });
    }

    function finish(data) {
      clearInterval(timerId);
      bar.style.width = "100%";
      panel.classList.remove("is-streaming");
      panel.classList.toggle("refused", !!data.refused);
      live.innerHTML = formatAnswerHtml(data.answer || raw, data.citations);
      footer.innerHTML = renderAnswerMeta(data);
      label.textContent = data.refused ? "Couldn’t ground an answer" : "Done";
      timer.textContent = formatMs(data.total_latency_ms);
    }

    function fail(message) {
      clearInterval(timerId);
      panel.classList.remove("is-streaming");
      live.innerHTML = "";
      footer.innerHTML = `<div class="error-banner">${escapeHtml(message)}</div>`;
      label.textContent = "Something went wrong";
    }

    return { setStage, appendToken, finish, fail, getRaw: () => raw };
  }

  function renderError(slot, message) {
    slot.innerHTML = `<div class="error-banner">${escapeHtml(message)}</div>`;
  }

  async function checkHealth() {
    try {
      const res = await fetch("/query/health", { cache: "no-store" });
      const data = await res.json();
      const ready = data.status === "ready";
      const backend = data.llm_backend || data.llm_model || "";
      const isMock = String(backend).includes("mock");
      els.health.dataset.state = ready ? (isMock ? "degraded" : "ready") : "degraded";
      if (!ready) {
        els.health.textContent = "Pipeline degraded";
      } else if (isMock) {
        els.health.textContent = "Mock LLM (answers limited)";
      } else {
        els.health.textContent = `Ready · ${data.llm_model || "ollama"}`;
      }
      els.health.title = [
        data.llm_backend && `LLM: ${data.llm_backend}`,
        data.embedding_backend && `Embeddings: ${data.embedding_backend}`,
        data.error,
      ]
        .filter(Boolean)
        .join(" · ");
    } catch {
      els.health.dataset.state = "offline";
      els.health.textContent = "API offline";
    }
  }

  async function readSse(response, onEvent) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";
      for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        let event = "message";
        const dataLines = [];
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        let payload = {};
        try {
          payload = JSON.parse(dataLines.join("\n"));
        } catch {
          payload = { raw: dataLines.join("\n") };
        }
        onEvent(event, payload);
      }
    }
  }

  async function askQuestion(question) {
    const live = createLivePanel(question);
    setBusy(true);

    const payload = {
      question,
      retrieval_mode: els.retrievalMode.value,
      top_k: Number(els.topK.value) || 5,
      include_eval_scores: els.includeEval.checked,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    let finished = false;

    try {
      live.setStage("retrieving", "Connecting…");
      const res = await fetch("/query/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        let detail = `Request failed (${res.status})`;
        try {
          const errBody = await res.json();
          detail = errBody.detail || detail;
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }

      await readSse(res, (event, data) => {
        if (event === "stage") {
          live.setStage(data.stage || "working", data.label || data.stage || "Working…");
        } else if (event === "token") {
          live.setStage("generating", "Writing your answer…");
          live.appendToken(data.text || "");
        } else if (event === "done") {
          finished = true;
          live.finish(data.response || {});
        } else if (event === "error") {
          throw new Error(data.message || "Stream error");
        }
      });

      if (!finished) {
        throw new Error("Stream ended before a complete answer arrived.");
      }
      checkHealth();
    } catch (err) {
      const msg =
        err.name === "AbortError"
          ? "Timed out waiting for the model. Try again — the first Ollama answer after idle can be slow."
          : err.message || "Something went wrong talking to the pipeline.";
      live.fail(msg);
    } finally {
      clearTimeout(timeout);
      setBusy(false);
      els.question.focus();
    }
  }

  els.settingsToggle.addEventListener("click", () => {
    const open = els.settingsPanel.hasAttribute("hidden");
    if (open) els.settingsPanel.removeAttribute("hidden");
    else els.settingsPanel.setAttribute("hidden", "");
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
    if (!question || busy) return;
    els.question.value = "";
    resizeTextarea();
    askQuestion(question);
  });

  renderExamples();
  checkHealth();
  setInterval(checkHealth, 30000);
  els.question.focus();
})();
