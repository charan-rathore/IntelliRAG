const $ = (id) => document.getElementById(id);
let csrf, latestDraft;
const ready = fetch("/api/session")
  .then((r) => r.json())
  .then((s) => (csrf = s.csrf));
function status(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}
async function api(path, data) {
  await ready;
  const r = await fetch("/api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify(data),
  });
  const out = await r.json();
  if (!r.ok) throw Error(out.error || "Request failed.");
  return out;
}
function busy(on) {
  document.querySelectorAll("button").forEach((b) => (b.disabled = on));
  $("files").disabled = on;
}
async function load(documents) {
  busy(true);
  status("Reading documents and building source-linked memories…");
  try {
    const r = await api("import", { documents });
    $("sources").replaceChildren(
      ...r.sources.map((s) => {
        const li = document.createElement("li"),
          small = document.createElement("small");
        li.textContent = s.title;
        small.textContent = s.blocks + " memory blocks · original preserved";
        li.append(small);
        return li;
      }),
    );
    $("output").hidden = true;
    $("draft-panel").hidden = true;
    status("Documents ready. Ask a question above.");
  } catch (e) {
    status(e.message, true);
  } finally {
    busy(false);
  }
}
$("files").onchange = async (e) => {
  const files = [...e.target.files];
  if (files.length > 10 || files.some((f) => f.size > 240000)) {
    status("Choose up to 10 text files, each at most 240KB.", true);
    return;
  }
  await load(
    await Promise.all(
      files.map(async (f) => ({ title: f.name, text: await f.text() })),
    ),
  );
};
$("sample").onclick = () =>
  load([
    {
      title: "Fictional · client review.md",
      text: "# Fictional client review\n\nPilot launch is proposed for Tuesday. Security sign-off is still pending. Maya owns the security review.\n\n## Decisions\n- Budget of ₹50,000 approved by Maya.\n\n## Actions\n- Maya to send security review by Friday.",
    },
    {
      title: "Fictional · next meeting.md",
      text: "# Fictional next meeting\n\nThe pilot launch is not approved. Security sign-off remains pending. Budget approval is unchanged. Next discussion will review security findings.",
    },
  ]);
$("ask").onsubmit = async (e) => {
  e.preventDefault();
  busy(true);
  status("Searching only this session’s documents…");
  $("draft-panel").hidden = true;
  try {
    const r = await api("query", { question: $("question").value });
    $("output").hidden = false;
    $("answer").textContent = r.answer;
    $("mode").textContent =
      r.mode +
      (r.evidenceStatus === "ambiguous"
        ? " Several sources are similarly relevant; no single resolved answer is established."
        : "");
    const existing = $("review-signals");
    existing?.remove();
    const panel = document.createElement("section");
    panel.id = "review-signals";
    const heading = document.createElement("h3");
    heading.textContent = "Across all your documents: points to reconcile";
    panel.append(heading);
    for (const [kind, items] of Object.entries(r.context.groups)) {
      if (!items.length) continue;
      const label = document.createElement("h4");
      label.textContent = {
        changes: "Changes mentioned",
        open: "Open items",
        conditions: "Conditions",
        decisions: "Decision statements (not verified approvals)",
      }[kind];
      panel.append(label);
      for (const c of items) {
        const p = document.createElement("p");
        p.className = "review-line";
        p.textContent =
          c.quote + " [" + c.title + ", line " + c.firstLine + "]";
        panel.append(p);
      }
    }
    const caution = document.createElement("p");
    caution.className = "note";
    caution.textContent =
      r.context.notice +
      " Scans all imported documents; check relevance to this question.";
    panel.append(caution);
    $("evidence").after(panel);
    $("timing").textContent = r.latencyMs + " ms retrieval";
    $("draft").disabled = r.refused;
    $("evidence").replaceChildren(
      ...r.evidence.map((c, i) => {
        const d = document.createElement("details"),
          s = document.createElement("summary"),
          p = document.createElement("pre"),
          h = document.createElement("p");
        s.textContent = `[${i + 1}] ${c.title} · lines ${c.firstLine}-${c.lastLine}`;
        p.textContent = c.quote;
        h.className = "hash";
        h.textContent = "SHA-256 " + c.hash;
        d.append(s, p, h);
        return d;
      }),
    );
    status(
      r.refused
        ? "No supporting evidence found. Try a more specific question."
        : "Evidence ready. Open an original passage to inspect it.",
    );
  } catch (e) {
    status(e.message, true);
  } finally {
    busy(false);
    if (!$("evidence").children.length) $("draft").disabled = true;
  }
};
$("draft").onclick = async () => {
  busy(true);
  try {
    latestDraft = await api("draft", {});
    $("subject").value = latestDraft.subject;
    $("body").value = latestDraft.body;
    $("draft-panel").hidden = false;
    status("Review draft ready. No recipient selected and nothing sent.");
  } catch (e) {
    status(e.message, true);
  } finally {
    busy(false);
  }
};
$("download").onclick = () => {
  const url = URL.createObjectURL(
    new Blob(["Subject: " + $("subject").value + "\n\n" + $("body").value], {
      type: "text/plain;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "follow-up-draft.txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("reset").onclick = async () => {
  busy(true);
  try {
    await api("reset", {});
    $("sources").replaceChildren();
    $("output").hidden = true;
    $("draft-panel").hidden = true;
    $("files").value = "";
    status("Session cleared. Add documents to start again.");
  } catch (e) {
    status(e.message, true);
  } finally {
    busy(false);
  }
};
