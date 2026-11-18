import sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from sketch import Sketch, ICONS

s = Sketch(2420, 1430, seed=11)
# logo
s.box(40, 36, 120, 120, "#111", rad=26)
s.parts.append('<g transform="translate(100,96)" fill="none" stroke="#f3d08a" stroke-width="7" stroke-linecap="round"><circle cx="-6" cy="-6" r="22"/><path d="M10 10 L28 28"/></g>')
s.text(190, 104, "IntelliRAG", "title")
s.text(192, 146, "How a question becomes a cited answer, or an honest refusal", "sub")

# You
s.box(30, 430, 290, 330, "#f7c9d9")
s.parts.append('<g transform="translate(175,500)" fill="none" stroke="#111" stroke-width="3.4" stroke-linecap="round">' + ICONS["user"].replace('r="7"', 'r="11"').replace("M-13 14 Q0 0 13 14", "M-20 22 Q0 2 20 22") + "</g>")
s.text(175, 585, "You", "h", "middle")
s.lines(175, 635, ["ask about a source", "pinned to a commit;", "click a citation to", "see the exact lines"], "bs", 30, "middle")

# Console
s.box(400, 190, 370, 470, "#bcdcf9")
s.text(585, 262, "Console", "h", "middle")
s.text(585, 298, "Vite + React · Vercel", "s", "middle")
s.lines(585, 360, ["Reading: answer, citations,", "coverage meter", "", "Lab: candidates, drop", "reasons, gate, timings,", "graph diagnostics"], "bs", 32, "middle")

# Eval
s.box(400, 900, 370, 330, "#fbe6a2")
s.parts.append('<g transform="translate(585,960)" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' + ICONS["flask"] + "</g>")
s.text(585, 1022, "Frozen eval", "h2", "middle")
s.lines(585, 1070, ["15 answerable + 5 refusal", "cases · no network", "arms: BM25 · rank pack", "· coverage pack"], "bs", 30, "middle")

# Runtime
s.box(840, 170, 720, 1170, "#bfeec3", rad=34)
s.text(1200, 236, "IntelliRAG runtime", "h", "middle")
cards = [
    (270, "retrieve", "BM25 · optional dense · RRF fusion", "search"),
    (408, "rerank", "calibrated: idf recall · phrase · title", "rank"),
    (546, "evidence gate", "support floor · rank-1 margin · refuse", "shield"),
    (684, "context packer", ["1,400 tokens · rank-order (default)", "or coverage-aware (opt-in)"], "box"),
    (842, "coverage check", "question terms the context never says", "check"),
    (980, "answer", "cited extracts, or a model with a key", "quote"),
]
for y, t, sub, ic in cards:
    s.card(890, y, 620, 112 if t != "context packer" else 128, t, sub, ic)
# store
s.card(890, 1180, 620, 120, "index + cache", ["chunks pinned to a revision; answer cache", "keyed by question · corpus · policy"], "db", fill="#fff")
s.box(870, 1158, 660, 164, "none", rad=22, sw=2.4, dash="10 9")

# vertical flow inside runtime
s.arrow([(1200, 382), (1200, 408)])
s.arrow([(1200, 520), (1200, 546)])
s.arrow([(1200, 658), (1200, 684)])
s.arrow([(1200, 812), (1200, 842)])
s.arrow([(1200, 954), (1200, 980)])
s.badge(1236, 395, "3"); s.text(1262, 403, "rank", "lab")
s.badge(1236, 533, "4"); s.text(1262, 541, "check support", "lab")
s.badge(1236, 671, "5"); s.text(1262, 679, "pack", "lab")
s.badge(1236, 827, "6"); s.text(1262, 835, "measure", "lab")
s.badge(1236, 967, "7"); s.text(1262, 975, "answer", "lab")

# 1 ask, 2 query
s.arrow([(320, 520), (400, 470)], "ask", "1", loff=(-34, -34))
s.arrow([(770, 300), (890, 326)], "query", "2", loff=(-8, -30))
# refuse out of the gate
s.arrow([(890, 602), (770, 560)], "refuse: nothing cited", None, loff=(-238, 44))
# answer back
s.arrow([(890, 1036), (700, 660)], "answer + trace", "8", loff=(-215, -10))
# index feeds retrieve
s.arrow([(890, 1240), (862, 1240), (862, 326), (890, 326)])
s.text(870, 760, "", "s")

# Sources
s.box(1650, 190, 740, 380, "#f8d3a8")
s.parts.append('<circle cx="2020" cy="262" r="34" fill="#111"/><g transform="translate(2020,262)" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"><circle cx="-9" cy="-14" r="5"/><circle cx="-9" cy="14" r="5"/><circle cx="11" cy="-4" r="5"/><path d="M-9 -9 V9 M11 1 Q11 8 -4 11"/></g>')
s.text(2020, 342, "GitHub source", "h2", "middle")
s.lines(2020, 392, ["README · PR body + patches", "pinned to a commit SHA", "chunked on headings, never", "inside a code fence"], "bs", 32, "middle")

# Model
s.box(1650, 640, 740, 270, "#d9cff8")
s.parts.append('<g transform="translate(1720,700)" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' + ICONS["chip"] + "</g>")
s.text(1765, 712, "Model (optional)", "h2")
s.lines(1700, 772, ["server key or a visitor's key, per request", "temperature 0 · cite-or-refuse prompt", "absent → cited extracts, labelled as such"], "bs", 32)

# A ingest, B generate, C replay
s.arrow([(1650, 540), (1600, 540), (1600, 1250), (1510, 1250)])
s.badge(1600, 605, "A", True); s.text(1624, 613, "ingest", "lab")
s.arrow([(1650, 880), (1510, 1040)])
s.badge(1672, 945, "B", True); s.text(1696, 953, "generate", "lab")
s.arrow([(770, 1120), (890, 1230)])
s.badge(676, 1262, "C", True); s.text(700, 1270, "replays the same functions", "lab")

# Legend
s.box(1650, 980, 740, 340, "#f8f8f4")
s.text(1690, 1044, "How to read it", "h3")
s.pill(1690, 1104, "1–2"); s.text(1786, 1112, "you ask; the console sends the query", "leg")
s.pill(1690, 1162, "3–7"); s.text(1786, 1170, "evidence is decided before any model", "leg")
s.pill(1690, 1220, "8"); s.text(1786, 1228, "answer, citations and what was missing", "leg")
s.pill(1690, 1278, "A–C", hollow=True); s.text(1786, 1286, "ingest, optional model, offline eval", "leg")

open(sys.argv[1], "w").write(s.svg())
