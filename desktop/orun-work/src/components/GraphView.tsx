// The component graph: every component as a node, every dependsOn as a wire,
// laid out left to right by dependency depth. Drag to pan, wheel to zoom.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { family, familyColor, FAMILY_LABEL, type Family } from "../lib/kinds";
import type { Repo } from "../lib/repo";
import type { Selection } from "../lib/types";

const W = 196;
const H = 46;
const COL = 250;
const ROW = 62;

interface Props {
  repo: Repo | null;
  selection: Selection;
  onSelect: (s: Selection) => void;
}

export function layout(repo: Repo, showTests: boolean, showInputs: boolean) {
  // Packages connect only through build-input edges, so they show with them.
  const comps = repo.components.filter((c) => {
    const f = family(c.type, c.root);
    return (showTests || f !== "test") && (showInputs || f !== "package");
  });
  const names = new Set(comps.map((c) => c.name));
  const deps = new Map(
    comps.map((c) => [
      c.name,
      c.dependsOn.filter((d) => names.has(d.component) && d.component !== c.name && (showInputs || !d.input)),
    ]),
  );
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (n: string): number => {
    if (depth.has(n)) return depth.get(n)!;
    if (visiting.has(n)) return 0; // a cycle (the documented peer loop): break it here
    visiting.add(n);
    const d = Math.max(-1, ...(deps.get(n) ?? []).map((x) => depthOf(x.component))) + 1;
    visiting.delete(n);
    depth.set(n, d);
    return d;
  };
  comps.forEach((c) => depthOf(c.name));
  const cols = new Map<number, typeof comps>();
  for (const c of comps) cols.set(depth.get(c.name)!, [...(cols.get(depth.get(c.name)!) ?? []), c]);
  const pos = new Map<string, { x: number; y: number }>();
  for (const [d, list] of cols) {
    list.sort((a, b) => family(a.type, a.root).localeCompare(family(b.type, b.root)) || a.name.localeCompare(b.name));
    list.forEach((c, i) => pos.set(c.name, { x: d * COL, y: i * ROW }));
  }
  const edges = comps.flatMap((c) =>
    (deps.get(c.name) ?? []).map((d) => ({ from: d.component, to: c.name, input: !!d.input, enforced: d.mode === "enforced" })),
  );
  return { comps, pos, edges };
}

export function GraphView({ repo, selection, onSelect }: Props) {
  const [showTests, setShowTests] = useState(false);
  const [showInputs, setShowInputs] = useState(false);
  const [view, setView] = useState({ x: 40, y: 40, k: 0.8 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);

  const g = useMemo(() => (repo ? layout(repo, showTests, showInputs) : null), [repo, showTests, showInputs]);
  const sel = selection?.kind === "component" ? selection.name : null;
  const related = useMemo(() => {
    const s = new Set<string>();
    if (!g || !sel) return s;
    for (const e of g.edges) {
      if (e.from === sel) s.add(e.to);
      if (e.to === sel) s.add(e.from);
    }
    return s;
  }, [g, sel]);

  const fit = () => {
    if (!g || !svgRef.current) return;
    const xs = [...g.pos.values()];
    const maxX = Math.max(...xs.map((p) => p.x)) + W;
    const maxY = Math.max(...xs.map((p) => p.y)) + H;
    const r = svgRef.current.getBoundingClientRect();
    if (r.width < 50 || r.height < 50) return;
    // Shrink to fit, but never below a readable size; a bigger graph starts
    // at its left (upstream) edge and pans.
    const k = Math.min(1.1, Math.max(0.6, Math.min((r.width - 60) / maxX, (r.height - 110) / maxY)));
    const x = maxX * k < r.width - 60 ? (r.width - maxX * k) / 2 : 30;
    const y = maxY * k < r.height - 110 ? (r.height - maxY * k) / 2 : 56;
    setView({ k, x, y });
  };

  // Fit once the canvas has its real size, and again for each new graph.
  const fitted = useRef<unknown>(null);
  useLayoutEffect(() => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!g || !r || r.width < 50 || r.height < 50 || fitted.current === g) return;
    fitted.current = g;
    fit();
  }, [g]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !g) return;
    const ro = new ResizeObserver(() => {
      if (fitted.current === g) return;
      const r = el.getBoundingClientRect();
      if (r.width < 50 || r.height < 50) return;
      fitted.current = g;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [g]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!repo || !g) {
    return <div className="empty" style={{ marginTop: "20vh" }}>Open an orun repository to see its component graph.</div>;
  }

  const families = [...new Set(g.comps.map((c) => family(c.type, c.root)))] as Family[];

  return (
    <>
      <svg
        ref={svgRef}
        className={`graph ${dragging ? "dragging" : ""}`}
        style={{ backgroundSize: `${24 * view.k}px ${24 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
          if (!d.moved) {
            d.moved = true;
            setDragging(true);
            (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
          }
          setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          setDragging(false);
          if (d && !d.moved && e.target === e.currentTarget) onSelect(null);
        }}
        onWheel={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const mx = e.clientX - r.left;
          const my = e.clientY - r.top;
          setView((v) => {
            const k = Math.min(2.5, Math.max(0.2, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
            return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
          });
        }}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {g.edges.map((e, i) => {
            const a = g.pos.get(e.from)!;
            const b = g.pos.get(e.to)!;
            const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
            const dx = Math.max(40, (x2 - x1) / 2);
            const hot = sel && (e.from === sel || e.to === sel);
            const cls = ["gedge", e.input ? "input" : "", e.enforced ? "enforced" : "", hot ? "hot" : "", sel && !hot ? "dim" : ""].join(" ");
            return <path key={i} className={cls} d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`} />;
          })}
          {g.comps.map((c) => {
            const p = g.pos.get(c.name)!;
            const fam = family(c.type, c.root);
            const cls = ["gnode", sel === c.name ? "selected" : "", related.has(c.name) ? "related" : "", sel && sel !== c.name && !related.has(c.name) ? "dim" : ""].join(" ");
            return (
              <g
                key={c.name}
                className={cls}
                transform={`translate(${p.x} ${p.y})`}
                onPointerUp={(e) => {
                  if (drag.current && !drag.current.moved) {
                    e.stopPropagation();
                    drag.current = null;
                    onSelect({ kind: "component", name: c.name });
                  }
                }}
              >
                <title>{c.description || c.name}</title>
                <rect className="body" width={W} height={H} rx={6} />
                <rect width={W} height={4} rx={2} fill={familyColor(fam)} />
                <circle cx={0} cy={H / 2} r={4.5} fill="#171b24" stroke={familyColor(fam)} strokeWidth={2} />
                <circle cx={W} cy={H / 2} r={4.5} fill={familyColor(fam)} />
                <text x={12} y={22}>{c.name.length > 26 ? c.name.slice(0, 25) + "…" : c.name}</text>
                <text x={12} y={37} className="sub">{c.type.length > 30 ? c.type.slice(0, 29) + "…" : c.type}</text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="graph-toolbar">
        <label><input type="checkbox" checked={showTests} onChange={(e) => setShowTests(e.target.checked)} /> Test suites</label>
        <label><input type="checkbox" checked={showInputs} onChange={(e) => setShowInputs(e.target.checked)} /> Build inputs</label>
        <button className="icon-btn" onClick={fit} title="Fit to view">⤢ Fit</button>
        <span style={{ color: "var(--faint)" }}>{g.comps.length} nodes · {g.edges.length} wires</span>
      </div>
      <div className="legend">
        {families.map((f) => (
          <span key={f}><i className="dot" style={{ background: familyColor(f) }} />{FAMILY_LABEL[f]}</span>
        ))}
        <span><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--warn)" strokeWidth="2" /></svg>enforced order</span>
        {showInputs && <span><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#6b7894" strokeWidth="2" strokeDasharray="4 3" /></svg>build input</span>}
      </div>
    </>
  );
}
