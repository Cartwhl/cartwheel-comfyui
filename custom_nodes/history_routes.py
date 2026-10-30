"""Local picker route. Keys stay in ComfyUI's saved connection settings."""

import asyncio
from pathlib import Path
from .transport import api_session
from aiohttp import web
from .route_security import same_origin

from .client import CartwheelError, Client
from .history import history_page, glb_history_page, history_summary, local_motion_sources


def register_history(server, read_connection, output_directory=None):
    @server.routes.get("/cartwheel/history")
    async def get_history(request):
        same_origin(request)
        try:
            configured = read_connection()
            async with api_session() as session:
                glb_only = request.query.get("glb_only") == "1"
                page = glb_history_page if glb_only else history_page
                items, token = await page(Client(configured, session), request.query.get("next_token"))
            known = await asyncio.to_thread(local_motion_sources, Path(output_directory()) / "cartwheel") if output_directory else {}
            summaries = [history_summary(item) for item in items]
            for summary in summaries:
                if summary["source_kind"] == "unknown":
                    summary["source_kind"] = known.get(summary["motion_id"], "unknown")
            return web.json_response({"items": summaries, "next_token": token,
                                      "connection": configured.fingerprint, "glb_only": glb_only}, headers={"Cache-Control": "no-store"})
        except (CartwheelError, ValueError) as error:
            return web.json_response({"error": str(error)}, status=400, headers={"Cache-Control": "no-store"})
