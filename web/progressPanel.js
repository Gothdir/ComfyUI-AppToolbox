// ComfyUI Toolbox — execution log, stats, model checker & downloader.
import { app } from "../../scripts/app.js";

const MAX_LINES = 500;

// Known model-loading node types → widget name + folder
const MODEL_NODES = {
    CheckpointLoaderSimple: [{ w: "ckpt_name", f: "checkpoints" }],
    CheckpointLoader: [{ w: "ckpt_name", f: "checkpoints" }],
    UNETLoader: [{ w: "unet_name", f: "diffusion_models" }],
    VAELoader: [{ w: "vae_name", f: "vae" }],
    CLIPLoader: [{ w: "clip_name", f: "text_encoders" }],
    DualCLIPLoader: [{ w: "clip_name1", f: "text_encoders" }, { w: "clip_name2", f: "text_encoders" }],
    TripleCLIPLoader: [{ w: "clip_name1", f: "text_encoders" }, { w: "clip_name2", f: "text_encoders" }, { w: "clip_name3", f: "text_encoders" }],
    LoraLoader: [{ w: "lora_name", f: "loras" }],
    LoraLoaderModelOnly: [{ w: "lora_name", f: "loras" }],
    ControlNetLoader: [{ w: "control_net_name", f: "controlnet" }],
    UpscaleModelLoader: [{ w: "model_name", f: "upscale_models" }],
    CLIPVisionLoader: [{ w: "clip_name", f: "clip_vision" }],
    StyleModelLoader: [{ w: "style_model_name", f: "style_models" }],
};

app.registerExtension({
    name: "local.toolbox",
    async setup() {
        const panel = document.createElement("div");
        panel.id = "pp-panel";
        panel.innerHTML = `
            <div id="pp-header">
                <div id="pp-header-btns">
                    <span id="pp-ram" title="System RAM usage">--</span>
                    <span id="pp-vram" title="VRAM usage">--</span>
                    <button id="pp-free" title="Free VRAM / unload models">💨 VRAM</button>
                    <button id="pp-reboot" title="Restart ComfyUI (requires Manager)">⟳ Restart</button>
                    <button id="pp-models" title="Scan workflow for missing models">📦 Models</button>
                    <button id="pp-clear" title="Clear log">🗑</button>
                </div>
            </div>
            <div id="pp-bar"><div id="pp-bar-fill"></div><div id="pp-bar-text">idle</div></div>
            <div id="pp-log"></div>
            <div id="pp-model-view" style="display:none"></div>`;

        const toggle = document.createElement("button");
        toggle.id = "pp-toggle";
        toggle.textContent = "🧰 Toolbox";
        toggle.title = "Toolbox — drag to move, click to open";

        const style = document.createElement("style");
        style.textContent = `
            #pp-toggle{position:fixed;left:12px;top:60px;z-index:9998;background:#2a2a2a;color:#ddd;border:1px solid #444;padding:6px 12px;border-radius:6px;font:12px sans-serif;cursor:grab;user-select:none}
            #pp-toggle.dragging{cursor:grabbing;opacity:.8}
            #pp-toggle:hover{background:#3a3a3a}
            #pp-panel{position:fixed;width:560px;height:400px;background:#1a1a1a;border:1px solid #444;border-radius:8px;display:none;flex-direction:column;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.5);font:12px monospace;color:#ddd}
            #pp-panel.open{display:flex}
            #pp-header{padding:8px 10px;background:#252525;border-bottom:1px solid #3a3a3a;display:flex;align-items:center;border-radius:8px 8px 0 0;font-family:sans-serif}
            #pp-header-btns{display:flex;gap:6px;align-items:center;flex:1}
            #pp-header-btns button{background:#333;border:1px solid #4a4a4a;color:#ddd;padding:5px 10px;border-radius:5px;cursor:pointer;font:11px sans-serif;transition:background .12s;white-space:nowrap}
            #pp-header-btns button:hover{background:#444;border-color:#5a5a5a}
            #pp-header-btns button:active{background:#2a2a2a}
            #pp-header-btns button:disabled{opacity:.4;cursor:not-allowed}
            #pp-clear{margin-left:auto;padding:5px 9px;font-size:13px}
            #pp-vram,#pp-ram{font:11px -apple-system,system-ui,sans-serif;padding:4px 8px;background:#1e1e1e;border:1px solid #3a3a3a;border-radius:5px;color:#8ec98e;white-space:nowrap;letter-spacing:.2px}
            #pp-vram.warn,#pp-ram.warn{color:#e9b96e;border-color:#5a4a2a}
            #pp-vram.crit,#pp-ram.crit{color:#ef7b7b;border-color:#5a2a2a;background:#2a1a1a}
            #pp-bar{position:relative;height:18px;background:#2a2a2a;overflow:hidden}
            #pp-bar-fill{height:100%;width:0%;background:linear-gradient(90deg,#4a9eff,#6ac);transition:width .15s ease}
            #pp-bar-text{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:11px sans-serif;color:#fff;text-shadow:0 0 3px rgba(0,0,0,.9),0 0 3px rgba(0,0,0,.9);pointer-events:none}
            #pp-log{flex:1;overflow-y:auto;padding:8px 12px;white-space:pre-wrap;word-break:break-word;line-height:1.5}
            #pp-log .ts{color:#666} #pp-log .ok{color:#7c7} #pp-log .warn{color:#e9a} #pp-log .err{color:#f66} #pp-log .info{color:#9cf}
            #pp-model-view{flex:1;overflow-y:auto;padding:10px 12px;font:12px -apple-system,system-ui,sans-serif}
            .mv-back{background:none;border:none;color:#9cf;cursor:pointer;font:12px sans-serif;padding:0 0 8px;text-decoration:underline}
            .mv-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:5px;margin:3px 0}
            .mv-row.found{background:#1a2a1a;border:1px solid #2a3a2a}
            .mv-row.missing{background:#2a1a1a;border:1px solid #3a2a2a}
            .mv-row.downloading{background:#1a1a2a;border:1px solid #2a2a3a}
            .mv-icon{font-size:14px;flex-shrink:0}
            .mv-info{flex:1;min-width:0}
            .mv-name{font-weight:600;color:#ddd;word-break:break-all}
            .mv-folder{font-size:10px;color:#888;margin-top:1px}
            .mv-dl{display:flex;gap:4px;align-items:center;flex-shrink:0}
            .mv-dl input{width:180px;padding:4px 6px;background:#222;border:1px solid #444;border-radius:4px;color:#ddd;font:11px monospace}
            .mv-dl button{padding:4px 10px;background:#2a5a2a;border:1px solid #3a6a3a;color:#cfc;border-radius:4px;cursor:pointer;font:11px sans-serif;white-space:nowrap}
            .mv-dl button:hover{background:#3a6a3a}
            .mv-dl button:disabled{opacity:.4;cursor:not-allowed}
            .mv-dl-progress{width:100%;height:3px;background:#333;border-radius:2px;margin-top:3px;overflow:hidden}
            .mv-dl-progress-fill{height:100%;background:#4a9eff;transition:width .3s}
            .mv-dl-status{font-size:10px;color:#9cf;margin-top:2px}
            .mv-summary{padding:6px 0 10px;color:#888;font-size:11px}
        `;
        document.head.appendChild(style);
        document.body.appendChild(panel);
        document.body.appendChild(toggle);

        const logEl = panel.querySelector("#pp-log");
        const barEl = panel.querySelector("#pp-bar-fill");
        const barText = panel.querySelector("#pp-bar-text");
        const modelView = panel.querySelector("#pp-model-view");

        const showLog = () => { logEl.style.display = ""; modelView.style.display = "none"; };
        const showModels = () => { logEl.style.display = "none"; modelView.style.display = ""; };

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
            const r = toggle.getBoundingClientRect();
            const pw = 560, ph = 400, margin = 8;
            let x = r.left, y = r.bottom + 6;
            if (x + pw > window.innerWidth - margin) x = window.innerWidth - pw - margin;
            if (y + ph > window.innerHeight - margin) y = r.top - ph - 6;
            if (x < margin) x = margin;
            if (y < margin) y = margin;
            panel.style.left = `${x}px`;
            panel.style.top = `${y}px`;
        };

        // ---- drag ----
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
            toggle.style.left = `${Math.max(0, Math.min(window.innerWidth - toggle.offsetWidth, origX + dx))}px`;
            toggle.style.top = `${Math.max(0, Math.min(window.innerHeight - toggle.offsetHeight, origY + dy))}px`;
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
                if (panel.classList.contains("open")) { anchorPanel(); startStatsPolling(); }
                else stopStatsPolling();
            }
        });
        window.addEventListener("resize", () => { if (panel.classList.contains("open")) anchorPanel(); });

        // ---- header buttons ----
        panel.querySelector("#pp-clear").onclick = () => { logEl.innerHTML = ""; };

        panel.querySelector("#pp-free").onclick = async () => {
            line("info", "→ freeing VRAM…");
            try {
                const r = await fetch("/free", { method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ unload_models: true, free_memory: true }) });
                line(r.ok ? "ok" : "err", r.ok ? "✓ VRAM freed" : `✗ /free returned ${r.status}`);
                updateStats();
            } catch (err) { line("err", `✗ ${err.message}`); }
        };

        panel.querySelector("#pp-reboot").onclick = async () => {
            if (!confirm("Restart ComfyUI? Current run will be lost.")) return;
            line("warn", "→ requesting reboot…");
            try {
                const r = await fetch("/manager/reboot", { method: "GET" });
                if (r.ok) line("ok", "✓ reboot requested — reload page when server is back");
                else line("err", `✗ /manager/reboot returned ${r.status} (is ComfyUI-Manager installed?)`);
            } catch (err) { line("warn", `server dropped connection (likely restarting): ${err.message}`); }
        };

        // ---- stats polling ----
        const vramEl = panel.querySelector("#pp-vram");
        const ramEl = panel.querySelector("#pp-ram");
        const gb = (n) => (n / (1024 ** 3)).toFixed(1);
        const setBadge = (el, used, total, label) => {
            if (typeof used !== "number" || typeof total !== "number" || total <= 0) { el.textContent = "??"; return; }
            const pct = (used / total) * 100;
            el.textContent = `${label} · ${gb(used)}/${gb(total)} · ${pct.toFixed(0)}%`;
            el.classList.toggle("warn", pct >= 70 && pct < 90);
            el.classList.toggle("crit", pct >= 90);
        };
        const updateStats = async () => {
            try {
                const r = await fetch("/api/system_stats");
                if (!r.ok) { vramEl.textContent = "n/a"; ramEl.textContent = "n/a"; return; }
                const d = await r.json();
                const dev = d?.devices?.[0];
                if (dev?.vram_total != null && dev?.vram_free != null) setBadge(vramEl, dev.vram_total - dev.vram_free, dev.vram_total, "VRAM");
                else vramEl.textContent = "??";
                const sys = d?.system;
                if (sys?.ram_total != null && sys?.ram_free != null) setBadge(ramEl, sys.ram_total - sys.ram_free, sys.ram_total, "RAM");
                else ramEl.textContent = "??";
            } catch { vramEl.textContent = "err"; ramEl.textContent = "err"; }
        };
        let statsTimer = null;
        const startStatsPolling = () => { updateStats(); if (statsTimer) clearInterval(statsTimer); statsTimer = setInterval(updateStats, 2000); };
        const stopStatsPolling = () => { if (statsTimer) { clearInterval(statsTimer); statsTimer = null; } };

        // ---- log helper ----
        const line = (cls, text) => {
            const ts = new Date().toLocaleTimeString();
            const row = document.createElement("div");
            row.innerHTML = `<span class="ts">[${ts}]</span> <span class="${cls}">${text}</span>`;
            logEl.appendChild(row);
            while (logEl.children.length > MAX_LINES) logEl.removeChild(logEl.firstChild);
            logEl.scrollTop = logEl.scrollHeight;
        };

        // ---- subgraph-aware node lookup ----
        const resolveNode = (rawId) => {
            const s = String(rawId);
            if (!s.includes(":")) return app.graph?.getNodeById?.(Number(s)) || null;
            const parts = s.split(":").map(Number);
            let graph = app.graph, node = null;
            for (let i = 0; i < parts.length; i++) {
                if (!graph?.getNodeById) return null;
                node = graph.getNodeById(parts[i]);
                if (!node) return null;
                if (i < parts.length - 1) { graph = node.subgraph || node._subgraph || null; if (!graph) return node; }
            }
            return node;
        };
        const labelFor = (rawId) => { const n = resolveNode(rawId); return n ? `${n.title || n.type || "node"} #${rawId}` : `node #${rawId}`; };

        // ---- execution events ----
        const api = app.api;
        let runStart = 0, currentNodeLabel = "";

        api.addEventListener("execution_start", (e) => {
            runStart = performance.now(); barEl.style.width = "0%"; barText.textContent = "starting…";
            line("info", `▶ Run started (prompt ${e.detail?.prompt_id ?? "?"})`);
        });
        api.addEventListener("executing", (e) => {
            const nodeId = e.detail;
            if (nodeId === null) {
                const dur = ((performance.now() - runStart) / 1000).toFixed(1);
                barEl.style.width = "100%"; barText.textContent = `done in ${dur}s`; currentNodeLabel = "";
                line("ok", `✓ Run finished in ${dur}s`);
            } else { currentNodeLabel = labelFor(nodeId); barEl.style.width = "0%"; barText.textContent = currentNodeLabel; line("info", `→ ${currentNodeLabel}`); }
        });
        api.addEventListener("progress", (e) => {
            const { value, max } = e.detail || {};
            if (typeof value === "number" && typeof max === "number" && max > 0) {
                const pct = (value / max) * 100; barEl.style.width = `${pct}%`;
                barText.textContent = `${currentNodeLabel ? currentNodeLabel + " — " : ""}${value}/${max} (${pct.toFixed(0)}%)`;
            }
        });
        api.addEventListener("execution_cached", (e) => { const n = e.detail?.nodes?.length ?? 0; if (n) line("ts", `cached ${n} node${n === 1 ? "" : "s"}`); });
        api.addEventListener("execution_error", (e) => {
            const d = e.detail || {};
            line("err", `✗ ${d.exception_type || "Error"}: ${d.exception_message || "unknown"}`);
            if (d.node_type) line("err", `  in ${d.node_type} (#${d.node_id})`);
            if (d.traceback) { const tb = Array.isArray(d.traceback) ? d.traceback.join("") : d.traceback; line("err", tb.split("\n").slice(-8).join("\n")); }
            panel.classList.add("open");
        });
        api.addEventListener("execution_interrupted", () => line("warn", "⊘ Interrupted"));

        // ==== MODEL CHECKER ====
        // Capture URLs from ComfyUI's native "Copy URL" buttons
        const captureModelUrls = async () => {
            const urls = {};
            const orig = navigator.clipboard.writeText;
            navigator.clipboard.writeText = async (text) => {
                if (text && text.includes('huggingface.co')) {
                    const filename = text.split('/').pop();
                    if (filename) urls[filename] = text;
                }
                return Promise.resolve();
            };
            const copyBtns = [...document.querySelectorAll('button')].filter(
                b => /copy url/i.test(b.textContent) && !b.id?.startsWith('dl-') && !b.id?.startsWith('pp-')
            );
            for (const btn of copyBtns) {
                try { btn.click(); } catch {}
                await new Promise(r => setTimeout(r, 80));
            }
            navigator.clipboard.writeText = orig;
            return urls;
        };

        const scanModels = async () => {
            // Try to capture URLs from ComfyUI's Missing Models panel first
            const knownUrls = await captureModelUrls();
            // 1. fetch available models from /object_info
            let objInfo;
            try {
                const r = await fetch("/object_info");
                objInfo = await r.json();
            } catch { modelView.innerHTML = '<div style="color:#f66;padding:20px">Failed to fetch /object_info</div>'; showModels(); return; }

            // 2. collect all model refs from graph
            const refs = []; // {name, folder, found, nodeType, nodeId}
            const seen = new Set();
            const allNodes = [];
            const collectNodes = (graph) => {
                if (!graph) return;
                const nodes = graph._nodes || graph.nodes || [];
                for (const n of nodes) {
                    allNodes.push(n);
                    if (n.subgraph || n._subgraph) collectNodes(n.subgraph || n._subgraph);
                }
            };
            collectNodes(app.graph);

            for (const node of allNodes) {
                const defs = MODEL_NODES[node.type];
                if (!defs) continue;
                for (const { w, f } of defs) {
                    const widget = node.widgets?.find(x => x.name === w);
                    const val = widget?.value;
                    if (!val || val === "None" || val === "none") continue;
                    const key = `${f}/${val}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    // check if available in object_info
                    const nodeInfo = objInfo[node.type];
                    const inputDef = nodeInfo?.input?.required?.[w];
                    const options = Array.isArray(inputDef?.[0]) ? inputDef[0] : [];
                    const found = options.includes(val);
                    refs.push({ name: val, folder: f, found, nodeType: node.type, nodeId: node.id });
                }
            }

            // 3. render
            const missing = refs.filter(r => !r.found);
            const found = refs.filter(r => r.found);
            let html = `<button class="mv-back" id="mv-back">← Back to Log</button>`;
            html += `<div class="mv-summary">Found ${refs.length} model${refs.length !== 1 ? "s" : ""} — <span style="color:#7c7">${found.length} ✓</span> / <span style="color:#f66">${missing.length} ✗</span></div>`;

            for (const m of missing) {
                const id = `dl-${m.folder}-${m.name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
                html += `<div class="mv-row missing" data-folder="${m.folder}" data-name="${m.name}">
                    <span class="mv-icon">❌</span>
                    <div class="mv-info">
                        <div class="mv-name">${m.name}</div>
                        <div class="mv-folder">📁 models/${m.folder}/ — ${m.nodeType}</div>
                        <div class="mv-dl">
                            <input type="text" id="${id}-url" placeholder="Paste HuggingFace URL…" spellcheck="false">
                            <button id="${id}-btn">⬇ Download</button>
                        </div>
                        <div class="mv-dl-progress" id="${id}-prog" style="display:none"><div class="mv-dl-progress-fill" id="${id}-fill"></div></div>
                        <div class="mv-dl-status" id="${id}-status"></div>
                    </div>
                </div>`;
            }
            for (const m of found) {
                html += `<div class="mv-row found"><span class="mv-icon">✅</span>
                    <div class="mv-info"><div class="mv-name">${m.name}</div>
                    <div class="mv-folder">📁 models/${m.folder}/ — ${m.nodeType}</div></div></div>`;
            }

            modelView.innerHTML = html;
            modelView.querySelector("#mv-back").onclick = showLog;

            // wire download buttons
            for (const m of missing) {
                const id = `dl-${m.folder}-${m.name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
                const btn = modelView.querySelector(`#${id}-btn`);
                const urlInput = modelView.querySelector(`#${id}-url`);
                const progBar = modelView.querySelector(`#${id}-prog`);
                const progFill = modelView.querySelector(`#${id}-fill`);
                const statusEl = modelView.querySelector(`#${id}-status`);
                if (!btn) continue;

                btn.onclick = async () => {
                    let url = urlInput.value.trim();
                    if (!url) { statusEl.textContent = "⚠ Paste a download URL first"; statusEl.style.color = "#e9a"; return; }
                    // If user pasted a HF page URL, convert to direct download
                    if (url.includes("huggingface.co") && !url.includes("/resolve/")) {
                        url = url.replace("/blob/", "/resolve/");
                    }
                    btn.disabled = true;
                    statusEl.textContent = "Starting…"; statusEl.style.color = "#9cf";
                    progBar.style.display = "";
                    try {
                        const r = await fetch("/toolbox/download", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ url, folder: m.folder, filename: m.name })
                        });
                        const d = await r.json();
                        if (!r.ok) { statusEl.textContent = `✗ ${d.error}`; statusEl.style.color = "#f66"; btn.disabled = false; return; }
                        // poll progress
                        const dlId = d.id;
                        const poll = setInterval(async () => {
                            try {
                                const sr = await fetch("/toolbox/download/status");
                                const all = await sr.json();
                                const st = all[dlId];
                                if (!st) return;
                                if (st.total > 0) {
                                    const pct = (st.progress / st.total * 100).toFixed(1);
                                    const dlMB = (st.progress / 1e6).toFixed(0);
                                    const totMB = (st.total / 1e6).toFixed(0);
                                    progFill.style.width = `${pct}%`;
                                    statusEl.textContent = `⬇ ${dlMB}/${totMB} MB (${pct}%)`;
                                } else {
                                    statusEl.textContent = `⬇ ${(st.progress / 1e6).toFixed(0)} MB…`;
                                }
                                if (st.status === "done") {
                                    clearInterval(poll);
                                    progFill.style.width = "100%";
                                    statusEl.textContent = "✓ Downloaded";
                                    statusEl.style.color = "#7c7";
                                    // update row style
                                    btn.closest(".mv-row").classList.remove("missing");
                                    btn.closest(".mv-row").classList.add("found");
                                    btn.closest(".mv-row").querySelector(".mv-icon").textContent = "✅";
                                    line("ok", `✓ Downloaded ${m.name} → models/${m.folder}/`);
                                }
                                if (st.status === "error") {
                                    clearInterval(poll);
                                    statusEl.textContent = `✗ ${st.error}`; statusEl.style.color = "#f66";
                                    btn.disabled = false;
                                    line("err", `✗ Download failed: ${m.name} — ${st.error}`);
                                }
                            } catch {}
                        }, 1000);
                    } catch (err) {
                        statusEl.textContent = `✗ ${err.message}`; statusEl.style.color = "#f66";
                        btn.disabled = false;
                    }
                };
            }
            showModels();

            // Auto-fill URLs captured from ComfyUI's Missing Models panel
            for (const m of missing) {
                const id = `dl-${m.folder}-${m.name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
                const urlInput = modelView.querySelector(`#${id}-url`);
                const statusEl = modelView.querySelector(`#${id}-status`);
                if (urlInput && knownUrls[m.name]) {
                    urlInput.value = knownUrls[m.name];
                    if (statusEl) { statusEl.textContent = "✓ URL auto-detected"; statusEl.style.color = "#7c7"; }
                }
            }
        };

        panel.querySelector("#pp-models").onclick = scanModels;

        line("ts", "Progress panel ready");
    },
});
