import copy, unittest
from test_camera import camera
from importlib import import_module
presets=import_module(camera.__package__+'.camera_presets')
class CameraTransitionTests(unittest.TestCase):
 def recipe(self):
  p=copy.deepcopy(presets.DEFAULT_PRESET);p.update(actors=[1],reference_actor=1,focus_point='hands',horizontal='front')
  keys=['target_mode','custom_target','actors','selection','composition','reference_actor','focus_point','frame_reference','follow_strength','focal_length','roll','fisheye_fov']
  a={k:copy.deepcopy(p[k]) for k in keys};b=copy.deepcopy(a);b.update(actors=[2],reference_actor=2,focal_length=80,roll=20)
  p['camera_transition']={'enabled':True,'fields':['target','focal_length','roll'],'start':a,'end':b};return p
 def test_roundtrip(self):
  p=self.recipe();original=copy.deepcopy(p);self.assertEqual(presets.validate_preset(p,[1,2],2)['camera_transition'],p['camera_transition']);self.assertEqual(p,original)
 def test_invalid(self):
  for key,value in [('focal_length',0),('roll',float('nan')),('actors',[7]),('custom_target',[0,float('inf'),0]),('position',[1,2,3])]:
   p=self.recipe();p['camera_transition']['end'][key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):presets.validate_preset(p,[1,2],2)
  p=self.recipe();p['camera_transition']['fields']=['position']
  with self.assertRaises(ValueError):presets.validate_preset(p,[1,2],2)
