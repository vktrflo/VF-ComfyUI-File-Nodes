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
    async def test_get_list_sorting(self):
        cur_dir = str(Path(__file__).parent.parent)
        resp_asc = await self.client.get(f"/api/vf-file-nodes/list?path={cur_dir}&filter=all&sort=name_asc")
        data_asc = await resp_asc.json()
        resp_desc = await self.client.get(f"/api/vf-file-nodes/list?path={cur_dir}&filter=all&sort=name_desc")
        data_desc = await resp_desc.json()

        assert resp_asc.status == 200 and resp_desc.status == 200
        if len(data_asc["files"]) >= 2:
            assert data_asc["files"][0]["name"] <= data_asc["files"][-1]["name"]
            assert data_desc["files"][0]["name"] >= data_desc["files"][-1]["name"]

    @unittest_run_loop
    async def test_resolve_path(self):
        cur_file = str(Path(__file__).resolve())
        resp = await self.client.get(f"/api/vf-file-nodes/resolve?path={cur_file}")
        assert resp.status == 200
        data = await resp.json()
        assert data["exists"] is True
        assert data["filename"] == "test_routes.py"

    @unittest_run_loop
    async def test_favorites_lifecycle(self):
        test_folder = str(Path(__file__).parent.resolve())

        # 1. Add favorite
        add_resp = await self.client.post("/api/vf-file-nodes/favorites/add", json={"path": test_folder, "name": "Tests"})
        assert add_resp.status == 200
        add_data = await add_resp.json()
        assert "favorites" in add_data
        assert any(f["path"] == test_folder for f in add_data["favorites"])

        # 2. Get favorites
        get_resp = await self.client.get("/api/vf-file-nodes/favorites")
        assert get_resp.status == 200
        get_data = await get_resp.json()
        assert any(f["path"] == test_folder for f in get_data["favorites"])

        # 3. Remove favorite
        rem_resp = await self.client.post("/api/vf-file-nodes/favorites/remove", json={"path": test_folder})
        assert rem_resp.status == 200
        rem_data = await rem_resp.json()
        assert not any(f["path"] == test_folder for f in rem_data["favorites"])
