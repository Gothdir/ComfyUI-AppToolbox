// ComfyUI Progress Panel — shows live execution events in a toggleable side panel.
// Install: ComfyUI/custom_nodes/progress-panel/web/progressPanel.js
// Also create an empty __init__.py in progress-panel/ so ComfyUI loads the pack.

import { app } from "../../scripts/app.js";

const MAX_LINES = 500;

app.registerExtension({
    name: "local.toolbox",

    async setup() {
        // ---- build DOM ----
        const panel = document.createElement("div");
        panel.id = "pp-panel";
        panel.innerHTML = `
            <div id="pp-header">
                <span>Toolbox</span>
                <div id="pp-header-btns">
                    <span id="pp-vram" title="VRAM usage">--</span>
                    <button id="pp-free" title="Free VRAM / unload models">💨 VRAM</button>
                    <button id="pp-reboot" title="Restart ComfyUI (requires Manager)">⟳ Restart</button>
                    <button id="pp-clear" title="Clear log">Clear</button>
                    <button id="pp-close" title="Close panel">✕</button>
                </div>
            </div>
            <div id="pp-bar">
                <div id="pp-bar-fill"></div>
                <div id="pp-bar-text">idle</div>
            </div>
            <div id="pp-log"></div>
        `;

        const toggle = document.createElement("button");
        toggle.id = "pp-toggle";
        toggle.textContent = "🧰 Toolbox";
        toggle.title = "Toolbox — drag to move, click to open";

        const style = document.createElement("style");
        style.textContent = `
            #pp-toggle {
                position: fixed; left: 12px; top: 60px; z-index: 9998;
                background: #2a2a2a; color: #ddd; border: 1px solid #444;
                padding: 6px 12px; border-radius: 6px; font: 12px sans-serif;
                cursor: grab; user-select: none;
            }
            #pp-toggle.dragging { cursor: grabbing; opacity: 0.8; }
            #pp-toggle:hover { background: #3a3a3a; }
            #pp-panel {
                position: fixed; width: 460px; height: 360px;
                background: #1a1a1a; border: 1px solid #444; border-radius: 8px;
                display: none; flex-direction: column; z-index: 9999;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5); font: 12px monospace;
                color: #ddd;
            }
            #pp-panel.open { display: flex; }
            #pp-header {
                padding: 6px 10px; background: #252525; border-bottom: 1px solid #444;
                display: flex; justify-content: space-between; align-items: center;
                border-radius: 8px 8px 0 0; font-family: sans-serif;
            }
            #pp-header-btns { display: flex; gap: 4px; }
            #pp-header-btns button {
                background: #333; border: 1px solid #555; color: #ddd;
                padding: 3px 8px; border-radius: 4px; cursor: pointer;
                font: 11px sans-serif;
            }
            #pp-header-btns button:hover { background: #444; }
            #pp-header-btns button:disabled { opacity: 0.4; cursor: not-allowed; }
            #pp-vram {
                font: 11px monospace; padding: 3px 6px;
                background: #222; border: 1px solid #444; border-radius: 4px;
                color: #7c7; min-width: 80px; text-align: center;
            }
            #pp-vram.warn { color: #e9a; }
            #pp-vram.crit { color: #f66; }
            #pp-bar {
                position: relative;
                height: 18px; background: #2a2a2a; overflow: hidden;
            }
            #pp-bar-fill {
                height: 100%; width: 0%; background: linear-gradient(90deg, #4a9eff, #6ac);
                transition: width 0.15s ease;
            }
            #pp-bar-text {
                position: absolute; inset: 0;
                display: flex; align-items: center; justify-content: center;
                font: 11px sans-serif; color: #fff;
                text-shadow: 0 0 3px rgba(0,0,0,0.9), 0 0 3px rgba(0,0,0,0.9);
                pointer-events: none;
            }
            #pp-log {
                flex: 1; overflow-y: auto; padding: 8px 12px;
                white-space: pre-wrap; word-break: break-word; line-height: 1.5;
            }
            #pp-log .ts { color: #666; }
            #pp-log .ok { color: #7c7; }
            #pp-log .warn { color: #e9a; }
            #pp-log .err { color: #f66; }
            #pp-log .info { color: #9cf; }
        `;
        document.head.appendChild(style);
        document.body.appendChild(panel);
        document.body.appendChild(toggle);

        const logEl = panel.querySelector("#pp-log");
        const barEl = panel.querySelector("#pp-bar-fill");
        const barText = panel.querySelector("#pp-bar-text");

        // ---- position restore ----
        const POS_KEY = "pp-toggle-pos";
        try {
            const saved = JSON.parse(localStorage.getItem(POS_KEY) || "null");
            if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
                toggle.style.left = `${saved.x}px`;
                toggle.style.top = `${saved.y}px`;
            }
        } catch {}

        const anchorPanel = () => {
            // position panel just below the toggle button, keep on-screen
            const r = toggle.getBoundingClientRect();
            const pw = 460, ph = 360, margin = 8;
            let x = r.left;
            let y = r.bottom + 6;
            if (x + pw > window.innerWidth - margin) x = window.innerWidth - pw - margin;
            if (y + ph > window.innerHeight - margin) y = r.top - ph - 6;
            if (x < margin) x = margin;
            if (y < margin) y = margin;
            panel.style.left = `${x}px`;
            panel.style.top = `${y}px`;
        };

        // ---- drag logic ----
        let dragging = false, moved = false, startX = 0, startY = 0, origX = 0, origY = 0;
        toggle.addEventListener("pointerdown", (e) => {
            dragging = true; moved = false;
            startX = e.clientX; startY = e.clientY;
            const r = toggle.getBoundingClientRect();
            origX = r.left; origY = r.top;
            toggle.classList.add("dragging");
            toggle.setPointerCapture(e.pointerId);
        });
        toggle.addEventListener("pointermove", (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX, dy = e.clientY - startY;
            if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
            const nx = Math.max(0, Math.min(window.innerWidth - toggle.offsetWidth, origX + dx));
            const ny = Math.max(0, Math.min(window.innerHeight - toggle.offsetHeight, origY + dy));
            toggle.style.left = `${nx}px`;
            toggle.style.top = `${ny}px`;
            toggle.style.right = "auto"; toggle.style.bottom = "auto";
            if (panel.classList.contains("open")) anchorPanel();
        });
        toggle.addEventListener("pointerup", (e) => {
            if (!dragging) return;
            dragging = false;
            toggle.classList.remove("dragging");
            toggle.releasePointerCapture(e.pointerId);
            const r = toggle.getBoundingClientRect();
            localStorage.setItem(POS_KEY, JSON.stringify({ x: r.left, y: r.top }));
            if (!moved) {
                panel.classList.toggle("open");
                if (panel.classList.contains("open")) {
                    anchorPanel();
                    startVramPolling();
                } else {
                    stopVramPolling();
                }
            }
        });
        window.addEventListener("resize", () => {
            if (panel.classList.contains("open")) anchorPanel();
        });

        // ---- header buttons ----
        panel.querySelector("#pp-close").onclick = () => {
            panel.classList.remove("open");
            stopVramPolling();
        };
        panel.querySelector("#pp-clear").onclick = () => { logEl.innerHTML = ""; };

        panel.querySelector("#pp-free").onclick = async () => {
            line("info", "→ freeing VRAM…");
            try {
                const r = await fetch("/free", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ unload_models: true, free_memory: true }),
                });
                line(r.ok ? "ok" : "err", r.ok ? "✓ VRAM freed" : `✗ /free returned ${r.status}`);
                updateVram();  // refresh readout immediately
            } catch (err) {
                line("err", `✗ ${err.message}`);
            }
        };

        // ---- VRAM polling ----
        const vramEl = panel.querySelector("#pp-vram");
        let vramLoggedShape = false;
        const updateVram = async () => {
            try {
                const r = await fetch("/api/system_stats");
                if (!r.ok) { vramEl.textContent = "n/a"; return; }
                const data = await r.json();
                const dev = data?.devices?.[0];
                if (!dev || typeof dev.vram_total !== "number" || typeof dev.vram_free !== "number") {
                    vramEl.textContent = "??";
                    if (!vramLoggedShape) {
                        console.log("[toolbox] system_stats shape:", data);
                        vramLoggedShape = true;
                    }
                    return;
                }
                const total = dev.vram_total;
                const used = total - dev.vram_free;
                const pct = (used / total) * 100;
                const gb = (n) => (n / (1024 ** 3)).toFixed(1);
                vramEl.textContent = `${gb(used)}/${gb(total)} GB (${pct.toFixed(0)}%)`;
                vramEl.classList.toggle("warn", pct >= 70 && pct < 90);
                vramEl.classList.toggle("crit", pct >= 90);
            } catch (err) {
                vramEl.textContent = "err";
            }
        };
        let vramTimer = null;
        const startVramPolling = () => {
            updateVram();
            if (vramTimer) clearInterval(vramTimer);
            vramTimer = setInterval(updateVram, 2000);
        };
        const stopVramPolling = () => {
            if (vramTimer) { clearInterval(vramTimer); vramTimer = null; }
        };

        panel.querySelector("#pp-reboot").onclick = async () => {
            if (!confirm("Restart ComfyUI? Current run will be lost.")) return;
            line("warn", "→ requesting reboot…");
            try {
                // ComfyUI-Manager exposes /manager/reboot
                const r = await fetch("/manager/reboot", { method: "GET" });
                if (r.ok) {
                    line("ok", "✓ reboot requested — reload page when server is back");
                } else {
                    line("err", `✗ /manager/reboot returned ${r.status} (is ComfyUI-Manager installed?)`);
                }
            } catch (err) {
                // server actually going down often causes a network error — that's the success case
                line("warn", `server dropped connection (likely restarting): ${err.message}`);
            }
        };

        const line = (cls, text) => {
            const ts = new Date().toLocaleTimeString();
            const row = document.createElement("div");
            row.innerHTML = `<span class="ts">[${ts}]</span> <span class="${cls}">${text}</span>`;
            logEl.appendChild(row);
            while (logEl.children.length > MAX_LINES) logEl.removeChild(logEl.firstChild);
            logEl.scrollTop = logEl.scrollHeight;
        };

        // ---- hook into ComfyUI's api events ----
        const api = app.api;
        let runStart = 0;
        let currentNodeLabel = "";

        api.addEventListener("execution_start", (e) => {
            runStart = performance.now();
            barEl.style.width = "0%";
            barText.textContent = "starting…";
            line("info", `▶ Run started (prompt ${e.detail?.prompt_id ?? "?"})`);
        });

        api.addEventListener("executing", (e) => {
            const nodeId = e.detail;
            if (nodeId === null) {
                const dur = ((performance.now() - runStart) / 1000).toFixed(1);
                barEl.style.width = "100%";
                barText.textContent = `done in ${dur}s`;
                currentNodeLabel = "";
                line("ok", `✓ Run finished in ${dur}s`);
            } else {
                const node = app.graph?.getNodeById?.(Number(nodeId));
                currentNodeLabel = node ? `${node.type} #${nodeId}` : `node #${nodeId}`;
                barEl.style.width = "0%";
                barText.textContent = currentNodeLabel;
                line("info", `→ ${currentNodeLabel}`);
            }
        });

        api.addEventListener("progress", (e) => {
            const { value, max } = e.detail || {};
            if (typeof value === "number" && typeof max === "number" && max > 0) {
                const pct = (value / max) * 100;
                barEl.style.width = `${pct}%`;
                const prefix = currentNodeLabel ? `${currentNodeLabel} — ` : "";
                barText.textContent = `${prefix}${value}/${max} (${pct.toFixed(0)}%)`;
            }
        });

        api.addEventListener("execution_cached", (e) => {
            const n = e.detail?.nodes?.length ?? 0;
            if (n) line("ts", `cached ${n} node${n === 1 ? "" : "s"}`);
        });

        api.addEventListener("execution_error", (e) => {
            const d = e.detail || {};
            line("err", `✗ ${d.exception_type || "Error"}: ${d.exception_message || "unknown"}`);
            if (d.node_type) line("err", `  in ${d.node_type} (#${d.node_id})`);
            if (d.traceback) {
                const tb = Array.isArray(d.traceback) ? d.traceback.join("") : d.traceback;
                line("err", tb.split("\n").slice(-8).join("\n"));
            }
            panel.classList.add("open"); // auto-open on error
        });

        api.addEventListener("execution_interrupted", () => line("warn", "⊘ Interrupted"));

        line("ts", "Progress panel ready");
    },
});
