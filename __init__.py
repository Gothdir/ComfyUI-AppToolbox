"""Toolbox — ComfyUI extension with model download support."""
import os
import asyncio
import aiohttp
from aiohttp import web

WEB_DIRECTORY = "./web"
NODE_CLASS_MAPPINGS = {}
__all__ = ["NODE_CLASS_MAPPINGS", "WEB_DIRECTORY"]

_downloads = {}

def _models_dir():
    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "models"
    )

try:
    from server import PromptServer

    @PromptServer.instance.routes.post("/toolbox/download")
    async def start_download(request):
        data = await request.json()
        url = data.get("url", "").strip()
        folder = data.get("folder", "").strip()
        filename = data.get("filename", "").strip()
        if not url or not folder or not filename:
            return web.json_response({"error": "url, folder, filename required"}, status=400)

        target_dir = os.path.join(_models_dir(), folder)
        os.makedirs(target_dir, exist_ok=True)
        target_path = os.path.join(target_dir, filename)

        if os.path.exists(target_path):
            return web.json_response({"error": "file already exists", "path": target_path}, status=409)

        dl_id = f"{folder}/{filename}"
        if dl_id in _downloads and _downloads[dl_id].get("status") == "downloading":
            return web.json_response({"error": "already downloading"}, status=409)

        _downloads[dl_id] = {"status": "starting", "progress": 0, "total": 0, "error": None}
        asyncio.ensure_future(_do_download(dl_id, url, target_path))
        return web.json_response({"id": dl_id, "status": "started", "path": target_path})

    async def _do_download(dl_id, url, target_path):
        tmp = target_path + ".part"
        try:
            _downloads[dl_id]["status"] = "downloading"
            async with aiohttp.ClientSession() as session:
                async with session.get(url, allow_redirects=True) as resp:
                    if resp.status != 200:
                        _downloads[dl_id] = {"status": "error", "error": f"HTTP {resp.status}", "progress": 0, "total": 0}
                        return
                    total = int(resp.headers.get("content-length", 0))
                    _downloads[dl_id]["total"] = total
                    done = 0
                    with open(tmp, "wb") as f:
                        async for chunk in resp.content.iter_chunked(1024 * 1024):
                            f.write(chunk)
                            done += len(chunk)
                            _downloads[dl_id]["progress"] = done
            os.rename(tmp, target_path)
            _downloads[dl_id]["status"] = "done"
            _downloads[dl_id]["progress"] = _downloads[dl_id]["total"]
        except Exception as e:
            _downloads[dl_id]["status"] = "error"
            _downloads[dl_id]["error"] = str(e)
            if os.path.exists(tmp):
                try: os.remove(tmp)
                except: pass

    @PromptServer.instance.routes.get("/toolbox/download/status")
    async def download_status(request):
        return web.json_response(_downloads)

    @PromptServer.instance.routes.post("/toolbox/download/cancel")
    async def cancel_download(request):
        # Mark as cancelled — the download loop checks this
        data = await request.json()
        dl_id = data.get("id", "")
        if dl_id in _downloads:
            _downloads[dl_id]["status"] = "cancelled"
        return web.json_response({"ok": True})

except ImportError:
    print("[toolbox] Could not import PromptServer — download features disabled")
