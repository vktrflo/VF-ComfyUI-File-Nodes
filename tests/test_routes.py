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

    @unittest_run_loop
    async def test_delete_supported_file_only(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            sup_file = Path(tmpdir) / "sample.png"
            sup_file.write_bytes(b"dummy image data")

            unsup_file = Path(tmpdir) / "sample.bin"
            unsup_file.write_bytes(b"dummy binary data")

            # 1. Attempt deleting unsupported file
            resp_unsup = await self.client.post("/api/vf-file-nodes/delete", json={"path": str(unsup_file)})
            assert resp_unsup.status == 400
            data_unsup = await resp_unsup.json()
            assert data_unsup["success"] is False
            assert unsup_file.exists()

            # 2. Deleting supported file
            resp_sup = await self.client.post("/api/vf-file-nodes/delete", json={"path": str(sup_file)})
            assert resp_sup.status == 200
            data_sup = await resp_sup.json()
            assert data_sup["success"] is True
            assert not sup_file.exists()

            # 3. Deleting non-existent file
            resp_none = await self.client.post("/api/vf-file-nodes/delete", json={"path": str(sup_file)})
            assert resp_none.status == 404

    @unittest_run_loop
    async def test_thumbnail_and_metadata(self):
        import tempfile
        from PIL import Image

        with tempfile.TemporaryDirectory() as tmpdir:
            test_img = Path(tmpdir) / "test_thumb.jpg"
            im = Image.new("RGB", (640, 480), color="blue")
            im.save(test_img, "JPEG")

            # 1. Test handle_list returns ctime and dimensions
            list_resp = await self.client.get(f"/api/vf-file-nodes/list?path={tmpdir}&filter=image")
            assert list_resp.status == 200
            list_data = await list_resp.json()
            assert len(list_data["files"]) == 1
            f = list_data["files"][0]
            assert f["name"] == "test_thumb.jpg"
            assert "ctime" in f and f["ctime"] > 0
            assert f["dimensions"] == [640, 480]

            # 2. Test handle_thumbnail generates JPEG stream
            thumb_resp = await self.client.get(f"/api/vf-file-nodes/thumbnail?path={test_img}")
            assert thumb_resp.status == 200
            assert thumb_resp.headers["Content-Type"] == "image/jpeg"
            thumb_bytes = await thumb_resp.read()
            assert len(thumb_bytes) > 0
            # Test it is a valid JPEG image
            with Image.open(Path(tmpdir) / "test_thumb.jpg") as read_im:
                assert read_im.size == (640, 480)

    @unittest_run_loop
    async def test_comfy_parameters(self):
        import json
        import tempfile
        from PIL import Image
        from PIL.PngImagePlugin import PngInfo

        # 1. Missing path
        resp = await self.client.get("/api/vf-file-nodes/comfy-parameters")
        assert resp.status == 400
        data = await resp.json()
        assert data["has_parameters"] is False

        # 2. Non-existent file
        resp_nf = await self.client.get("/api/vf-file-nodes/comfy-parameters?path=nonexistent.png")
        assert resp_nf.status == 200
        data_nf = await resp_nf.json()
        assert data_nf["has_parameters"] is False

        with tempfile.TemporaryDirectory() as tmpdir:
            # 3. File without parameters
            plain_img = Path(tmpdir) / "plain.jpg"
            Image.new("RGB", (32, 32), color="red").save(plain_img, "JPEG")
            resp_plain = await self.client.get(f"/api/vf-file-nodes/comfy-parameters?path={plain_img}")
            assert resp_plain.status == 200
            data_plain = await resp_plain.json()
            assert data_plain["has_parameters"] is False

            # 4. File with embedded ComfyUI prompt & workflow
            prompt_graph = {
                "3": {
                    "class_type": "KSampler",
                    "inputs": {
                        "seed": 123456789,
                        "steps": 25,
                        "cfg": 7.5,
                        "sampler_name": "euler_ancestral",
                        "scheduler": "karras",
                        "denoise": 1.0,
                        "model": ["4", 0],
                        "positive": ["6", 0],
                        "negative": ["7", 0],
                    },
                },
                "4": {
                    "class_type": "CheckpointLoaderSimple",
                    "inputs": {
                        "ckpt_name": "sd_xl_base_1.0.safetensors",
                    },
                },
                "6": {
                    "class_type": "CLIPTextEncode",
                    "inputs": {
                        "text": "a majestic lion in golden sunset",
                    },
                },
                "7": {
                    "class_type": "CLIPTextEncode",
                    "inputs": {
                        "text": "blurry, low quality",
                    },
                },
            }
            workflow_graph = {
                "nodes": [{"id": 3, "type": "KSampler"}],
                "extra": {},
            }

            info = PngInfo()
            info.add_text("prompt", json.dumps(prompt_graph))
            info.add_text("workflow", json.dumps(workflow_graph))

            comfy_img = Path(tmpdir) / "comfy_gen.png"
            Image.new("RGB", (64, 64), color="green").save(comfy_img, "PNG", pnginfo=info)

            resp_comfy = await self.client.get(f"/api/vf-file-nodes/comfy-parameters?path={comfy_img}")
            assert resp_comfy.status == 200
            data_comfy = await resp_comfy.json()
            assert data_comfy["has_parameters"] is True
            assert data_comfy["seed"] == 123456789
            assert data_comfy["steps"] == 25
            assert data_comfy["cfg"] == 7.5
            assert data_comfy["sampler"] == "euler_ancestral"
            assert data_comfy["scheduler"] == "karras"
            assert data_comfy["positive_prompt"] == "a majestic lion in golden sunset"
            assert data_comfy["negative_prompt"] == "blurry, low quality"
            assert data_comfy["models"] == ["sd_xl_base_1.0.safetensors"]
            assert data_comfy["has_workflow"] is True
            assert isinstance(data_comfy["workflow"], dict)
            assert isinstance(data_comfy["prompt"], dict)


