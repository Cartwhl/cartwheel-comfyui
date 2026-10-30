import copy,json,unittest
from test_camera import camera
class PriorityCameraTests(unittest.TestCase):
 def settings(self):
  return camera.DEFAULT_SETTINGS|{'mode':'bookends','world_frame_id':'test','start':{'position':[0,2,5],'target':[0,1,0],'fov':35},'end':{'position':[3,2,5],'target':[0,1,0],'fov':35},'manual_path':{'kind':'curve','pacing':'linear','aim':'source','controls':[[1,2,5],[2,2,5]],'smooth_handles':False,'source_static':False,'lens_override':False,'source_frames':[{'time':t,'position':[t,2,5],'quaternion':[0,0,0,1],'fov':35+t} for t in [0,1,2]]}}
 def test_curved_source_interpolation_survives_save_validation(self):
  s=self.settings();s['manual_path']['position_interpolation']='cubic';clean=camera.camera_settings(json.dumps(s),[1],1,'test',2)
  self.assertEqual(clean['manual_path']['position_interpolation'],'cubic');self.assertEqual(clean['manual_path']['source_frames'],s['manual_path']['source_frames'])
  for invalid in ['invalid',None,[],{}]:
   s['manual_path']['position_interpolation']=invalid
   with self.subTest(invalid=invalid),self.assertRaises(ValueError):camera.camera_settings(s,[1],1,'test',2)
 def test_starting_camera_samples_roundtrip(self):
  s=self.settings();clean=camera.camera_settings(json.dumps(s),[1],1,'test',2)
  self.assertEqual(clean['manual_path'],s['manual_path'])
 def test_bad_sample_order_rotation_and_duration_are_rejected(self):
  for change in ['order','quaternion','duration','missing','too_many']:
   s=self.settings();p=s['manual_path']
   if change=='order':p['source_frames'][1]['time']=0
   elif change=='quaternion':p['source_frames'][0]['quaternion']=[0,0,0,0]
   elif change=='duration':p['source_frames'][-1]['time']=1.9
   elif change=='missing':del p['source_frames']
   else:p['source_frames']*=5000
   with self.subTest(change=change),self.assertRaises(ValueError):camera.camera_settings(s,[1],1,'test',2)
