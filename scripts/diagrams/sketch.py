"""Tiny hand-drawn-style SVG diagram kit (rough double-stroke boxes, numbered arrows, legend)."""
import math, random, html

class Sketch:
    def __init__(self, w, h, seed=7):
        self.w, self.h = w, h
        self.r = random.Random(seed)
        self.parts = []

    def j(self, a=2.2):
        return self.r.uniform(-a, a)

    def _rr_path(self, x, y, w, h, rad, jit):
        j = lambda: self.j(jit)
        p = [
            f"M{x+rad+j():.1f} {y+j():.1f}",
            f"L{x+w-rad+j():.1f} {y+j():.1f}",
            f"Q{x+w+j():.1f} {y+j():.1f} {x+w+j():.1f} {y+rad+j():.1f}",
            f"L{x+w+j():.1f} {y+h-rad+j():.1f}",
            f"Q{x+w+j():.1f} {y+h+j():.1f} {x+w-rad+j():.1f} {y+h+j():.1f}",
            f"L{x+rad+j():.1f} {y+h+j():.1f}",
            f"Q{x+j():.1f} {y+h+j():.1f} {x+j():.1f} {y+h-rad+j():.1f}",
            f"L{x+j():.1f} {y+rad+j():.1f}",
            f"Q{x+j():.1f} {y+j():.1f} {x+rad+j():.1f} {y+j():.1f}Z",
        ]
        return " ".join(p)

    def box(self, x, y, w, h, fill="#fff", rad=26, sw=3.2, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.parts.append(f'<path d="{self._rr_path(x,y,w,h,rad,1.6)}" fill="{fill}" stroke="#111" stroke-width="{sw}" stroke-linejoin="round"{d}/>')
        if not dash:
            self.parts.append(f'<path d="{self._rr_path(x,y,w,h,rad,1.6)}" fill="none" stroke="#111" stroke-width="{sw*0.55:.2f}" stroke-linejoin="round" opacity="0.55"/>')

    def text(self, x, y, s, cls="bs", anchor="start"):
        self.parts.append(f'<text x="{x}" y="{y}" class="{cls}" text-anchor="{anchor}">{html.escape(s)}</text>')

    def lines(self, x, y, items, cls="bs", lh=30, anchor="start"):
        for i, s in enumerate(items):
            self.text(x, y + i * lh, s, cls, anchor)

    def card(self, x, y, w, h, title, sub=None, icon=None, fill="#fff", tcls="h3", scls="bs"):
        """White module card inside a zone: icon circle + title + subtitle."""
        self.box(x, y, w, h, fill, rad=18, sw=3)
        tx = x + 30
        if icon:
            cx, cy = x + 52, y + h / 2
            self.parts.append(f'<circle cx="{cx}" cy="{cy}" r="27" fill="#fff" stroke="#111" stroke-width="2.6"/>')
            self.parts.append(f'<g transform="translate({cx},{cy})" fill="none" stroke="#111" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">{ICONS[icon]}</g>')
            tx = x + 98
        if sub:
            subs = sub if isinstance(sub, list) else [sub]
            top = y + h / 2 - (len(subs) * 28) / 2 + 2
            self.text(tx, top, title, tcls)
            for i, s in enumerate(subs):
                self.text(tx, top + 32 + i * 28, s, scls)
        else:
            self.text(tx, y + h / 2 + 11, title, tcls)

    def arrow(self, pts, label=None, num=None, lpos=0.5, loff=(0, -14), hollow=False, bend=0.0):
        (x1, y1), (x2, y2) = pts[0], pts[-1]
        if len(pts) == 2 and bend:
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            nx, ny = -(y2 - y1), (x2 - x1)
            L = math.hypot(nx, ny) or 1
            cx, cy = mx + nx / L * bend, my + ny / L * bend
            d = f"M{x1} {y1} Q{cx:.1f} {cy:.1f} {x2} {y2}"
            tx, ty = 2 * (x2 - cx), 2 * (y2 - cy)
            ax, ay = mx + nx / L * bend / 2, my + ny / L * bend / 2
        else:
            d = "M" + " L".join(f"{x+self.j(0.8):.1f} {y+self.j(0.8):.1f}" for x, y in pts[:-1]) + f" L{x2} {y2}"
            px, py = pts[-2]
            tx, ty = x2 - px, y2 - py
            # label anchor along the polyline at lpos of the first segment set
            seg = pts[min(len(pts) - 2, int(lpos * (len(pts) - 1)))]
            seg2 = pts[min(len(pts) - 1, int(lpos * (len(pts) - 1)) + 1)]
            ax, ay = (seg[0] + seg2[0]) / 2, (seg[1] + seg2[1]) / 2
        self.parts.append(f'<path d="{d}" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round"/>')
        ang = math.atan2(ty, tx)
        hl = 16
        a1 = (x2 - hl * math.cos(ang - 0.42), y2 - hl * math.sin(ang - 0.42))
        a2 = (x2 - hl * math.cos(ang + 0.42), y2 - hl * math.sin(ang + 0.42))
        self.parts.append(f'<path d="M{a1[0]:.1f} {a1[1]:.1f} L{x2} {y2} L{a2[0]:.1f} {a2[1]:.1f}" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>')
        if label or num:
            lx, ly = ax + loff[0], ay + loff[1]
            bx = lx
            if num:
                self.badge(lx, ly, num, hollow)
                bx = lx + 22
            if label:
                self.text(bx, ly + 7, label, "lab")

    def badge(self, x, y, num, hollow=False):
        r = 18
        fill, color = ("#fff", "#111") if hollow else ("#111", "#fff")
        self.parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" stroke="#111" stroke-width="2.4"/>')
        self.parts.append(f'<text x="{x}" y="{y+7}" class="num" text-anchor="middle" fill="{color}">{num}</text>')

    def pill(self, x, y, text, hollow=False, w=70):
        fill, color = ("#fff", "#111") if hollow else ("#111", "#fff")
        self.parts.append(f'<rect x="{x}" y="{y-17}" width="{w}" height="34" rx="17" fill="{fill}" stroke="#111" stroke-width="2.4"/>')
        self.parts.append(f'<text x="{x+w/2}" y="{y+7}" class="numS2" text-anchor="middle" fill="{color}">{text}</text>')

    def svg(self):
        style = """<style>
.title{font:600 80px Poppins;fill:#111;letter-spacing:-.5px}.sub{font:400 31px Poppins;fill:#333}
.h{font:600 40px Poppins;fill:#111}.h2{font:600 34px Poppins;fill:#111}.h3{font:600 29px Poppins;fill:#111}
.bs{font:400 21.5px Poppins;fill:#222}.s{font:500 20px Poppins;fill:#333}.s2{font:500 23px Poppins;fill:#2d6a3a}
.lab{font:600 21px Poppins;fill:#111;paint-order:stroke;stroke:#fff;stroke-width:8px;stroke-linejoin:round}
.num{font:700 20px Poppins}.numS2{font:700 19px Poppins}.leg{font:500 23px Poppins;fill:#222}.mono{font:500 19px 'DejaVu Sans Mono';fill:#333}
</style>"""
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}">'
                + style + f'<rect width="{self.w}" height="{self.h}" fill="#fff"/>' + "".join(self.parts) + "</svg>")

# 24px-ish line icons centred on 0,0 (stroke only)
ICONS = {
    "user": '<circle cx="0" cy="-7" r="7"/><path d="M-13 14 Q0 0 13 14"/>',
    "search": '<circle cx="-3" cy="-3" r="9"/><path d="M4 4 L13 13"/>',
    "rank": '<path d="M-12 10 V2 M-4 10 V-4 M4 10 V-10 M12 10 V-1"/>',
    "shield": '<path d="M0 -14 L12 -9 V0 Q12 10 0 15 Q-12 10 -12 0 V-9Z"/><path d="M-5 0 L-1 4 L6 -4"/>',
    "box": '<path d="M-13 -6 L0 -13 L13 -6 L13 8 L0 15 L-13 8Z M-13 -6 L0 1 L13 -6 M0 1 V15"/>',
    "check": '<rect x="-12" y="-13" width="24" height="26" rx="4"/><path d="M-6 -4 L-2 0 L6 -8 M-6 7 H6"/>',
    "quote": '<path d="M-12 -10 H12 V6 H-2 L-9 13 V6 H-12Z"/><path d="M-6 -3 H6 M-6 1 H3"/>',
    "db": '<ellipse cx="0" cy="-9" rx="12" ry="5"/><path d="M-12 -9 V9 Q0 16 12 9 V-9 M-12 0 Q0 7 12 0"/>',
    "doc": '<path d="M-10 -14 H4 L11 -7 V14 H-10Z M4 -14 V-7 H11"/><path d="M-5 0 H6 M-5 6 H6"/>',
    "graph": '<circle cx="-9" cy="-8" r="4"/><circle cx="9" cy="-6" r="4"/><circle cx="0" cy="10" r="4"/><path d="M-6 -6 L6 -6 M-7 -4 L-2 7 M7 -2 L2 7"/>',
    "clock": '<circle cx="0" cy="0" r="13"/><path d="M0 -7 V0 L6 4"/>',
    "rewind": '<path d="M2 -9 L-8 0 L2 9Z M12 -9 L2 0 L12 9Z"/>',
    "pen": '<path d="M-11 11 L-9 3 L6 -12 L12 -6 L-3 9Z M3 -9 L9 -3"/>',
    "next": '<path d="M-12 0 H10 M3 -8 L11 0 L3 8"/>',
    "chip": '<rect x="-10" y="-10" width="20" height="20" rx="3"/><path d="M-5 -14 V-10 M5 -14 V-10 M-5 10 V14 M5 10 V14 M-14 -5 H-10 M-14 5 H-10 M10 -5 H14 M10 5 H14"/>',
    "flask": '<path d="M-5 -14 H5 M-3 -14 V-4 L-12 12 H12 L3 -4 V-14"/><path d="M-7 4 H7"/>',
    "plug": '<path d="M-6 -14 V-6 M6 -14 V-6 M-10 -6 H10 V0 Q10 8 0 8 Q-10 8 -10 0Z M0 8 V15"/>',
}
