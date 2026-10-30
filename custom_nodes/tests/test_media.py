import importlib
import math
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import types
import unittest

import av
import numpy as np

pkg = types.ModuleType('cw_media_tests'); pkg.__path__=[str(Path(__file__).resolve().parents[1])]; sys.modules[pkg.__name__]=pkg
media=importlib.import_module(pkg.__name__+'.media')
source=importlib.import_module(pkg.__name__+'.source_media')


def make_video(path, frames=48, fps=24, audio=True):
    with av.open(str(path),'w') as output:
        video=output.add_stream('libx264',rate=fps);video.width=video.height=64;video.pix_fmt='yuv420p'
        sound=output.add_stream('aac',rate=48000) if audio else None
        if sound: sound.layout='mono'
        for i in range(frames):
            frame=av.VideoFrame.from_ndarray(np.full((64,64,3),40+i%100,dtype=np.uint8),format='rgb24');frame.pts=i
            for packet in video.encode(frame):output.mux(packet)
        for packet in video.encode():output.mux(packet)
        if sound:
            samples=round(frames/fps*48000)
            wave=np.sin(np.arange(samples)*2*np.pi*440/48000).astype(np.float32)[None,:]*.1
            for start in range(0,samples,1024):
                frame=av.AudioFrame.from_ndarray(wave[:,start:start+1024].copy(),format='fltp',layout='mono')
                frame.sample_rate=48000;frame.pts=start
                for packet in sound.encode(frame):output.mux(packet)
            for packet in sound.encode():output.mux(packet)


class MediaTests(unittest.TestCase):
    def test_frame_count_rational_fps_first_frame_and_audio(self):
        with TemporaryDirectory() as directory:
            path=Path(directory)/'source.mp4';make_video(path,frames=50,fps=25)
            info=media.inspect_video(path)
            self.assertEqual((info['fps_numerator'],info['fps_denominator'],info['frame_count']),(25,1,50))
            self.assertEqual(info['duration'],2)
            self.assertTrue(info['has_audio']);self.assertFalse(info['variable_frame_rate'])
            image,audio=media.source_parts(path)
            self.assertEqual(tuple(image.shape),(1,64,64,3));self.assertEqual(tuple(audio['waveform'].shape[:2]),(1,1))
            self.assertEqual(audio['sample_rate'],48000)
            self.assertGreater(float(audio['waveform'].abs().max()),.05)
            self.assertAlmostEqual(audio['waveform'].shape[-1]/audio['sample_rate'],2,delta=.03)

    def test_silent_and_unreadable_source_are_explicit(self):
        with TemporaryDirectory() as directory:
            path=Path(directory)/'silent.mp4';make_video(path,audio=False)
            self.assertFalse(media.inspect_video(path)['has_audio'])
            self.assertIsNone(media.source_parts(path)[1])
            path.write_bytes(b'invalid')
            with self.assertRaisesRegex(ValueError,'could not be read'):media.inspect_video(path)

    def test_capture_limits_before_submission(self):
        media.validate_capture_video({'duration':30,'size_bytes':249999999})
        for bad in [{'duration':30.1,'size_bytes':1},{'duration':1,'size_bytes':250000000}]:
            with self.assertRaises(ValueError):media.validate_capture_video(bad)

    def test_duration_rounding_limits_and_longer_reference_than_output(self):
        self.assertEqual(media.validate_references('Seedance 2.5',19.4),20)
        self.assertEqual(media.validate_references('Seedance 2.5',19.5),20)
        with self.assertRaisesRegex(ValueError,'cover'):media.validate_references('MiniMax H3',14,8)
        for model,duration,requested in [('MiniMax H3',19.4,8),('MiniMax H3',14,19),('Seedance 2.5',30.5,20),('Seedance 2.5',1,4),('Seedance 2.5',float('nan'),5)]:
            with self.assertRaises(ValueError):media.validate_references(model,duration,requested)


class ReferenceWindowTests(unittest.TestCase):
    def test_automatic_model_caps_and_short_clips(self):
        for model,maximum in [('Seedance 2.5',30),('MiniMax H3',15)]:
            with self.subTest(model=model):
                for length,expected in [(45,maximum),(8,8),(maximum,maximum)]:
                    window=media.reference_windows(model,length)
                    self.assertEqual((window['start'],window['duration'],window['end']),(0,expected,expected))
                self.assertEqual(media.reference_windows(model,45,start=40)['duration'],5)
                self.assertEqual(media.reference_windows(model,45,start=10,duration=5)['end'],15)
                self.assertEqual(media.reference_windows(model,45,start=10,end=18)['duration'],8)
                self.assertEqual(media.reference_windows(model,45,duration=999)['duration'],maximum)
                self.assertEqual(media.validate_references(model,1.8),4)

    def test_aggregate_video_budget(self):
        for model,maximum in [('Seedance 2.5',30),('MiniMax H3',15)]:
            auto=media.reference_windows(model,45,secondary_available=45)
            self.assertEqual(auto['duration'],maximum/2)
            self.assertEqual(auto['secondary']['duration'],maximum/2)
            short=media.reference_windows(model,45,secondary_available=2)
            self.assertEqual(short['duration'],maximum-2)
            reserved=media.reference_windows(model,45,secondary_available=45,secondary_start=5,secondary_duration=3)
            self.assertEqual(reserved['secondary'],{'start':5,'duration':3,'end':8})
            self.assertEqual(reserved['duration'],maximum-3)
            for primary in [2,5,45]:
                for secondary in [2,5,45]:
                    for requested in [0,4,50]:
                        plan=media.reference_windows(model,primary,duration=requested,secondary_available=secondary)
                        self.assertLessEqual(plan['duration']+plan['secondary']['duration'],maximum)
                        self.assertLessEqual(plan['duration'],primary)
                        self.assertLessEqual(plan['secondary']['duration'],secondary)

    def test_invalid_or_empty_selections(self):
        for args in [dict(start=45),dict(start=46),dict(start=-1),dict(duration=float('nan')),
                     dict(start=True),dict(start=8,end=8),dict(start=9,end=8),dict(duration=5,end=8),
                     dict(start=44),dict(duration=1),dict(secondary_available=1),
                     dict(secondary_available=4,secondary_start=4),dict(secondary_duration=float('inf'))]:
            with self.subTest(args=args),self.assertRaises(ValueError):media.reference_windows('MiniMax H3',45,**args)
        with self.assertRaises(ValueError):media.reference_windows('unknown',45)

    def test_audio_window_preserves_rate_channels_and_bounds(self):
        audio={'waveform':media.torch.arange(20*100,dtype=media.torch.float32).reshape(1,1,-1).repeat(1,2,1),'sample_rate':100}
        clipped=media.trim_audio(audio,8,start=3)
        self.assertEqual(tuple(clipped['waveform'].shape),(1,2,800))
        self.assertEqual(float(clipped['waveform'][0,0,0]),300)
        self.assertEqual(media.trim_audio(audio,30)['waveform'].shape[-1],2000)
        self.assertEqual(audio['waveform'].shape[-1],2000)
        for start in [19,30,-1,float('nan')]:
            with self.assertRaises(ValueError):media.trim_audio(audio,8,start=start)


class SourceHistoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_public_media_lookup_download_and_file_reuse(self):
        with TemporaryDirectory() as directory:
            root=Path(directory);original=root/'original.mp4';make_video(original,audio=False)
            dest=root/'saved';dest.mkdir()
            class Client:
                calls=[]
                async def api(self,method,route):
                    self.calls.append((method,route));return {'fileExtension':'mp4','mediaDownloadURL':'https://example.com/source?secret=private'}
                async def download(self,url,path,check):check();path.write_bytes(original.read_bytes())
            client=Client();item={'sourceVideoMediaID':'media-test'}
            one,warnings=await source.history_source(client,item,dest,lambda:None)
            two,_=await source.history_source(client,item,dest,lambda:None)
            self.assertEqual(one,two);self.assertFalse(warnings)
            self.assertEqual(client.calls,[('GET','/media/media-test')])
            self.assertNotIn('https://',str(one));self.assertNotIn('secret',str(one))

    async def test_missing_deleted_invalid_and_interrupted_sources(self):
        with TemporaryDirectory() as directory:
            class Client:
                async def api(self,*args):raise source.CartwheelError('unavailable')
            for item in [{},{'sourceVideoMediaID':'../bad'},{'sourceVideoMediaID':'media-deleted'}]:
                result,warnings=await source.history_source(Client(),item,Path(directory),lambda:None)
                self.assertIsNone(result);self.assertTrue(warnings)
            def stop():raise RuntimeError('interrupted')
            with self.assertRaisesRegex(RuntimeError,'interrupted'):
                await source.history_source(Client(),{'sourceVideoMediaID':'media-test'},Path(directory),stop)
