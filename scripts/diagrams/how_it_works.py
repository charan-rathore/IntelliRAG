"""Draws docs/images/how-it-works.svg: what IntelliRAG does before any question
(offline), on every question (online), and after an answer (learning).

Icons: Lucide (ISC). Logos: Simple Icons (CC0). Run: python scripts/diagrams/how_it_works.py
"""
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent.parent / "docs" / "images" / "how-it-works.svg"

INK, MUTED, SUBTLE = "#1c1c19", "#55554e", "#7a7a71"
GREEN, GREEN_SOFT = "#2f6f45", "#e5efe7"
SAND, SAND_SOFT = "#a2742f", "#f6efe2"
YELLOW = "#f4e36b"
PLUM, PLUM_SOFT = "#6b4f8a", "#efe9f5"
LOGO_COLORS = {"github": "#181717", "markdown": "#000000", "postgresql": "#4169E1", "sqlite": "#003B57", "googlegemini": "#8E75B2", "claude": "#D97757", "anthropic": "#191919"}

def icon(name, x, y, size, color):
    raw = (HERE / "icons" / f"{name}.svg").read_text()
    inner = re.search(r">(.*)</svg>", raw, re.S).group(1)
    return (f'<svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="{color}" '
            f'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{inner}</svg>')

def logo(name, x, y, size):
    raw = (HERE / "logos" / f"{name}.svg").read_text()
    d = re.search(r'<path d="([^"]+)"', raw).group(1)
    return f'<svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="0 0 24 24"><path d="{d}" fill="{LOGO_COLORS.get(name, INK)}"/></svg>'

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def card(x, y, w, h, title, lines, ic, tint, soft, logos=(), step=None):
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="#ffffff" stroke="#e3e2da"/>']
    out.append(f'<circle cx="{x + 34}" cy="{y + 34}" r="20" fill="{soft}"/>')
    out.append(icon(ic, x + 22, y + 22, 24, tint))
    for i, lg in enumerate(logos):
        out.append(logo(lg, x + w - 30 - i * 26, y + 22, 20))
    if step:
        out.append(f'<text x="{x + w - 16}" y="{y + 60}" text-anchor="end" font-size="11" fill="{SUBTLE}" font-family="ui-monospace,monospace">{step}</text>')
    out.append(f'<text x="{x + 16}" y="{y + 80}" font-size="15" font-weight="650" fill="{INK}">{esc(title)}</text>')
    for i, line in enumerate(lines):
        out.append(f'<text x="{x + 16}" y="{y + 102 + i * 18}" font-size="12.5" fill="{MUTED}">{esc(line)}</text>')
    return "".join(out)

def arrow(x1, y1, x2, y2, color, dashed=False):
    dash = ' stroke-dasharray="5 5"' if dashed else ""
    return (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="2"{dash}/>'
            f'<path d="M{x2 - 7},{y2 - 5} L{x2},{y2} L{x2 - 7},{y2 + 5}" fill="none" stroke="{color}" stroke-width="2"/>')

W, CW, CH, GAP = 1440, 196, 150, 28
parts = []
parts.append(f'<text x="48" y="58" font-size="28" font-weight="700" fill="{INK}" letter-spacing="-0.5">How IntelliRAG answers, and how it gets better</text>')
parts.append(f'<text x="48" y="86" font-size="15" fill="{MUTED}">Sources are prepared once, ahead of time. Each question then takes milliseconds of search before any model runs. What you rate feeds back in.</text>')

# Lane 1: offline
y1 = 120
parts.append(f'<rect x="24" y="{y1}" width="{W - 48}" height="250" rx="24" fill="{SAND_SOFT}"/>')
parts.append(icon("clock", 48, y1 + 20, 18, SAND))
parts.append(f'<text x="74" y="{y1 + 34}" font-size="13" font-weight="700" fill="{SAND}" letter-spacing="1.2">BEFORE ANY QUESTION · OFFLINE</text>')
parts.append(f'<text x="{W - 48}" y="{y1 + 34}" text-anchor="end" font-size="13" fill="{MUTED}">Runs when you import a source, and in the background. No question needed.</text>')
offline = [
    ("Bring sources", ["Repos, docs, Markdown,", "PDFs. Pinned to a commit."], "file-text", ["github", "markdown"]),
    ("Cut into passages", ["By heading for prose,", "by function for code."], "scissors", []),
    ("Index every word", ["Keyword index, plus where", "each function is defined."], "search", []),
    ("Add meaning", ["Optional vectors, when", "an embedding key is set."], "sparkles", ["googlegemini"]),
    ("Store", ["Postgres when deployed,", "a local file otherwise."], "database", ["postgresql", "sqlite"]),
]
x = 48
for i, (t, ls, ic, lg) in enumerate(offline):
    parts.append(card(x, y1 + 56, CW, CH, t, ls, ic, SAND, "#efe2c8", lg, step=f"0{i + 1}"))
    if i < len(offline) - 1:
        parts.append(arrow(x + CW + 4, y1 + 56 + CH / 2, x + CW + GAP - 4, y1 + 56 + CH / 2, SAND))
    x += CW + GAP
# sleep card at end of offline lane
sx = x
parts.append(card(sx, y1 + 56, 212, CH, "Sleep", ["Replays rated questions;", "keeps a new link only if", "no working answer breaks."], "moon", PLUM, PLUM_SOFT))

# Lane 2: online
y2 = 400
parts.append(f'<rect x="24" y="{y2}" width="{W - 48}" height="250" rx="24" fill="{GREEN_SOFT}"/>')
parts.append(icon("user", 48, y2 + 20, 18, GREEN))
parts.append(f'<text x="74" y="{y2 + 34}" font-size="13" font-weight="700" fill="{GREEN}" letter-spacing="1.2">EVERY QUESTION · ONLINE</text>')
parts.append(f'<text x="{W - 48}" y="{y2 + 34}" text-anchor="end" font-size="13" fill="{MUTED}">About 5 ms of search on a laptop CPU, then the model, if one is set.</text>')
online = [
    ("Ask", ["Plain words, a GitHub", "issue, or a stack trace."], "user", []),
    ("Read the code it names", ["Paths and Class.method", "lead to their files."], "code-xml", []),
    ("Search two ways", ["Exact words and meaning,", "merged by rank."], "git-merge", []),
    ("Rank with memory", ["Passages people confirmed", "for similar questions rise."], "list-ordered", []),
    ("Evidence gate", ["Only passages that clear", "it may be cited."], "shield-check", []),
    ("Answer or refuse", ["Every sentence cites [n].", "Nothing clears: it says so."], "message-square-quote", ["claude", "googlegemini"]),
]
CW2, GAP2 = 196, 24
x = 48
for i, (t, ls, ic, lg) in enumerate(online):
    tint, soft = (GREEN, "#d3e6d8")
    parts.append(card(x, y2 + 56, CW2, CH, t, ls, ic, tint, soft, lg, step=f"{i + 1}"))
    if i < len(online) - 1:
        parts.append(arrow(x + CW2 + 3, y2 + 56 + CH / 2, x + CW2 + GAP2 - 3, y2 + 56 + CH / 2, GREEN))
    x += CW2 + GAP2

# The online search reads what offline built.
ix = 48 + 2 * (CW + GAP) + CW / 2
parts.append(f'<path d="M{ix},{y1 + 56 + CH + 4} L{ix},{y2 + 50}" stroke="{SAND}" stroke-width="1.6" stroke-dasharray="4 4"/>')
parts.append(f'<path d="M{ix - 5},{y2 + 42} L{ix},{y2 + 50} L{ix + 5},{y2 + 42}" fill="none" stroke="{SAND}" stroke-width="1.6"/>')
parts.append(f'<text x="{ix + 10}" y="{y1 + 56 + CH + 34}" font-size="12" fill="{SAND}">searches the index built above</text>')

# Lane 3: learning loop
y3 = 680
parts.append(f'<rect x="24" y="{y3}" width="{W - 48}" height="118" rx="24" fill="#ffffff" stroke="#e3e2da"/>')
parts.append(f'<circle cx="74" cy="{y3 + 59}" r="22" fill="{YELLOW}"/>')
parts.append(icon("thumbs-up", 62, y3 + 47, 24, INK))
parts.append(f'<text x="112" y="{y3 + 52}" font-size="15" font-weight="650" fill="{INK}">After the answer, it learns</text>')
parts.append(f'<text x="112" y="{y3 + 74}" font-size="12.5" fill="{MUTED}">Mark an answer Useful or Dead end, or click "This passage answers my question".</text>')
parts.append(f'<text x="112" y="{y3 + 92}" font-size="12.5" fill="{MUTED}">The question is filed against that passage. Next time a similar question ranks it higher (step 4), and sleep builds on it.</text>')
# loop arrows: from feedback up to rank-with-memory and to sleep
rank_x = 48 + 3 * (CW2 + GAP2) + CW2 / 2
parts.append(f'<path d="M820,{y3} C820,{y3 - 20} {rank_x},{y3 - 6} {rank_x},{y2 + 56 + CH + 6}" fill="none" stroke="{INK}" stroke-width="1.6" stroke-dasharray="5 5"/>')
parts.append(f'<path d="M{rank_x - 5},{y2 + 56 + CH + 14} L{rank_x},{y2 + 56 + CH + 6} L{rank_x + 5},{y2 + 56 + CH + 14}" fill="none" stroke="{INK}" stroke-width="1.6"/>')
parts.append(f'<path d="M1240,{y3} C1240,{y3 - 60} 1376,{y3 - 80} 1376,{y2} L1376,{y1 + 56 + CH + 12}" fill="none" stroke="{PLUM}" stroke-width="1.6" stroke-dasharray="5 5"/>')
parts.append(f'<path d="M1371,{y1 + 56 + CH + 20} L1376,{y1 + 56 + CH + 12} L1381,{y1 + 56 + CH + 20}" fill="none" stroke="{PLUM}" stroke-width="1.6"/>')
parts.append(f'<text x="1210" y="{y3 + 64}" text-anchor="end" font-size="12" fill="{PLUM}">ratings feed the sleep cycle ↗</text>')

H = 822
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
       f'font-family="Geist, Inter, \'Segoe UI\', system-ui, sans-serif"><rect width="{W}" height="{H}" fill="#fbfaf6"/>{"".join(parts)}</svg>')
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(svg)
print("wrote", OUT)
