import os
from pathlib import Path
import pytest
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from vf_file_nodes.routes import setup_routes

class TestFileNodesRoutes(AioHTTPTestCase):
    async def get_application(self):
        app = web.Application()
        setup_routes(app)
        return app

    @unittest_run_loop
    async def test_get_drives(self):
        resp = await self.client.get("/api/vf-file-nodes/drives")
        assert resp.status == 200
        data = await resp.json()
        assert "drives" in data
        assert isinstance(data["drives"], list)
        assert len(data["drives"]) > 0

    @unittest_run_loop
    async def test_get_list_empty_or_invalid(self):
        resp = await self.client.get("/api/vf-file-nodes/list?path=nonexistent_xyz")
        assert resp.status == 200
        data = await resp.json()
        assert data["exists"] is False
        assert data["files"] == []

    @unittest_run_loop
    async def test_get_list_valid_dir(self):
        cur_dir = str(Path(__file__).parent.parent)
        resp = await self.client.get(f"/api/vf-file-nodes/list?path={cur_dir}&filter=all")
        assert resp.status == 200
        data = await resp.json()
        assert data["exists"] is True
        assert len(data["dirs"]) > 0

    @unittest_run_loop
    async def test_resolve_path(self):
        cur_file = str(Path(__file__).resolve())
        resp = await self.client.get(f"/api/vf-file-nodes/resolve?path={cur_file}")
        assert resp.status == 200
        data = await resp.json()
        assert data["exists"] is True
        assert data["filename"] == "test_routes.py"
