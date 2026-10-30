import asyncio
from io import BytesIO
import importlib
from pathlib import Path
from tempfile import TemporaryDirectory
import sys
import types
import unittest
from uuid import uuid4

import av
from PIL import Image

package = types.ModuleType("cartwheel_render_tests")
package.__path__ = [str(Path(__file__).resolve().parents[1])]
sys.modules[package.__name__] = package
render = importlib.import_module(f"{package.__name__}.video_render")


def png(width=32, height=32, color="white"):
    buffer = BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


class RenderTests(unittest.TestCase):
    def test_mp4_has_every_ordered_frame_at_the_requested_rate(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "render.mp4"
            job = render.VideoRender(path, 32, 32, 24)
            job.duration = 0.5
            self.assertEqual(job.start(100), 12)  # The server timeline overrides the browser handshake.
            for index in range(12):
                job.add_frame(index, png(color="white" if index < 6 else "black"))
            job.finish()
            self.assertEqual(job.completed.result(), path)
            self.assertFalse(job.temporary.exists())
            with av.open(str(path)) as video:
                self.assertEqual(video.streams.video[0].average_rate, 24)
                frames = list(video.decode(video=0))
                self.assertEqual(len(frames), 12)
                self.assertGreater(frames[0].to_ndarray(format="rgb24").mean(), 250)
                self.assertLess(frames[-1].to_ndarray(format="rgb24").mean(), 5)
                self.assertAlmostEqual(float(frames[-1].time), 11 / 24)

    def test_every_control_pass_matches_the_beauty_timeline_and_endpoint_images(self):
        with TemporaryDirectory() as directory:
            main=render.VideoRender(Path(directory)/'camera.mp4',32,32,24)
            for kind in ['depth','normal','pose']:main.pass_renders[kind]=render.VideoRender(Path(directory)/(kind+'.mp4'),32,32,24)
            main.start(.5)
            for i in range(12):
                main.add_frame(i,png(color='red'))
                for child in main.pass_renders.values():child.add_frame(i,png(color='white' if i<6 else 'black'))
            main.finish()
            for child in main.pass_renders.values():
                with av.open(str(child.destination)) as v:self.assertEqual(len(list(v.decode(video=0))),12)
            self.assertTrue(main.destination.with_suffix('.first.png').is_file());self.assertTrue(main.destination.with_suffix('.last.png').is_file())

    def test_out_of_order_and_wrong_size_frames_are_rejected(self):
        with TemporaryDirectory() as directory:
            job = render.VideoRender(Path(directory) / "render.mp4", 32, 32, 24)
            job.start(1)
            with self.assertRaisesRegex(ValueError, "timeline order"):
                job.add_frame(1, png())
            with self.assertRaisesRegex(ValueError, "dimensions"):
                job.add_frame(0, png(64, 32))
            with self.assertRaisesRegex(ValueError, "every frame"):
                job.finish()
            job.abort("cancelled")
            with self.assertRaisesRegex(RuntimeError, "cancelled"):
                job.completed.result()
            self.assertFalse(job.temporary.exists())
            self.assertFalse(job.destination.exists())

    def test_invalid_durations_never_start_encoding(self):
        with TemporaryDirectory() as directory:
            for duration in [0, -1, float("nan"), 121]:
                job = render.VideoRender(Path(directory) / "render.mp4", 32, 32, 24)
                with self.assertRaises(ValueError):
                    job.start(duration)
                self.assertFalse(job.temporary.exists())


class CameraExportTests(unittest.TestCase):
    def test_sampled_camera_matches_render_grid_and_is_saved_atomically(self):
        with TemporaryDirectory() as directory:
            path=Path(directory)/'render.mp4';job=render.VideoRender(path,32,32,2);job.require_camera_track=True
            job.start(1)
            for i in range(2):job.add_frame(i,png())
            import json
            track={'schema_version':1,'units':'meters','up':'Y','fps':2,'aspect':1,'frames':[{'time':t,'position':[t,2,5],'quaternion':[0,0,0,1],'fov':45,'roll':0} for t in [0,.5,1]],'render_actors':[]}
            wrong=dict(track,fps=3)
            with self.assertRaisesRegex(ValueError,'timeline'):job.finish(wrong)
            self.assertFalse(path.with_suffix('.camera.json').exists())
            job.finish(track)
            saved=json.loads(path.with_suffix('.camera.json').read_text())
            self.assertEqual(saved['frames'],track['frames']);self.assertEqual(saved['width'],32)
            self.assertTrue(path.is_file())


class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_job_is_targeted_to_the_requesting_browser_and_cleaned_up(self):
        bridge = render.RenderBridge()
        messages = []
        descriptor = {"camera": {"cameras": [{"aspect": 9 / 16}]}}
        server = types.SimpleNamespace(client_id="test-client", sockets={"test-client": object()})
        def send(event, data, sid):
            messages.append((event, data, sid))
            job = bridge.jobs[data["token"]]
            self.assertEqual((job.width, job.height), (720, 1280))
            self.assertEqual(data["camera"], {"timeline": {"duration": 0.5}})
            self.assertEqual(job.duration, 0.5)
            job.destination.parent.mkdir(parents=True, exist_ok=True)
            job.destination.write_bytes(b"mock video")
            job.completed.set_result(job.destination)
        server.send_sync = send
        async def progress(value):
            pass
        with TemporaryDirectory() as directory:
            result = await bridge.render(server, str(uuid4()), descriptor, directory, "720p", "24", 0, lambda: None, progress, camera={"timeline": {"duration": 0.5}})
            self.assertTrue(result.is_file())
        self.assertEqual(messages[0][0], "cartwheel.render")
        self.assertEqual(messages[0][2], "test-client")
        self.assertEqual(bridge.jobs, {})

    async def test_missing_browser_and_interrupt_fail_without_leaving_jobs(self):
        bridge = render.RenderBridge()
        descriptor = {"camera": {"cameras": [{"aspect": 16 / 9}]}}
        server = types.SimpleNamespace(client_id=None, sockets={}, send_sync=lambda *args: None)
        async def progress(value):
            pass
        with TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "remain connected"):
                await bridge.render(server, str(uuid4()), descriptor, directory, "720p", "24", 0, lambda: None, progress)
            server.client_id = "test-client"
            server.sockets["test-client"] = object()
            def interrupted():
                raise RuntimeError("interrupted")
            with self.assertRaisesRegex(RuntimeError, "interrupted"):
                await bridge.render(server, str(uuid4()), descriptor, directory, "720p", "24", 0, interrupted, progress)
        await asyncio.sleep(0)
        self.assertEqual(bridge.jobs, {})


    async def test_output_ratio_overrides_native_capture_dimensions(self):
        descriptor = {"camera": {"cameras": [{"aspect": 9/16}]}}
        for orientation in ['landscape','portrait']:
            for ratio, landscape in [('16:9',(1280,720)),('4:3',(960,720)),('1:1',(720,720)),('21:9',(1680,720))]:
                with self.subTest(orientation=orientation,ratio=ratio), TemporaryDirectory() as directory:
                    bridge = render.RenderBridge()
                    expected = landscape if orientation == 'landscape' else landscape[::-1]
                    server = types.SimpleNamespace(client_id='local',sockets={'local':object()})
                    def send(event,data,sid):
                        self.assertEqual((data['width'],data['height']),expected)
                        job = bridge.jobs[data['token']]
                        self.assertEqual((job.width,job.height),expected)
                        job.destination.parent.mkdir(parents=True,exist_ok=True)
                        job.destination.write_bytes(b'mocked render')
                        job.completed.set_result(job.destination)
                    server.send_sync = send
                    async def progress(value): pass
                    camera = {'timeline':{'duration':1},'settings':{'output_frame':{'orientation':orientation,'ratio':ratio}}}
                    await bridge.render(server,str(uuid4()),descriptor,directory,'720p','24',0,lambda:None,progress,camera=camera)
                    self.assertEqual(bridge.jobs,{})
