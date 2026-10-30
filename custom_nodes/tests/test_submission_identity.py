import hashlib,importlib,json,sys,types,unittest
from pathlib import Path
from tempfile import TemporaryDirectory
pkg=types.ModuleType('cw_identity_tests');pkg.__path__=[str(Path(__file__).resolve().parents[1])];sys.modules[pkg.__name__]=pkg
identity=importlib.import_module(pkg.__name__+'.submission_identity')
class IdentityTests(unittest.TestCase):
 def test_batch_label_does_not_change_identity_but_account_source_settings_version_do(self):
  fields={'account':'key-a','source':'video-a'};opts={'batchName':'old','actors':2}
  expected=identity.request_identity(fields,opts)
  self.assertEqual(expected,identity.request_identity(fields,{**opts,'batchName':'legacy-batch-label'}))
  self.assertEqual(expected,identity.request_identity(fields,{'actors':2}))
  for f,o,v in [({**fields,'account':'key-b'},opts,0),({**fields,'source':'video-b'},opts,0),(fields,{**opts,'actors':3},0),(fields,opts,1)]:self.assertNotEqual(expected,identity.request_identity(f,o,v))
 def test_legacy_capture_alias_requires_exact_account_source_options_and_version(self):
  with TemporaryDirectory() as tmp:
   root=Path(tmp);fields={'account':'a','source':'v'};options={'actors':2,'batchName':'old name'}
   raw=hashlib.sha256(json.dumps({**fields,'options':options},sort_keys=True).encode()).hexdigest();path=root/(raw+'.json');path.write_text(json.dumps({'batch_name':'old name','phase':'submitted','batch_id':'batch-1'}))
   new={k:v for k,v in options.items() if k!='batchName'}
   found,key=identity.request_state_path(root,fields,new);self.assertEqual(found,path)
   for f,o,v in [({**fields,'account':'b'},new,0),(fields,{**new,'actors':3},0),(fields,new,1)]:self.assertNotEqual(identity.request_state_path(root,f,o,version=v)[0],path)
   path.write_text(json.dumps({'phase':'complete','request_identity':key}));self.assertEqual(identity.request_state_path(root,fields,new)[0],path)
 def test_unknown_preupgrade_swing_submission_is_not_silently_replaced(self):
  with TemporaryDirectory() as tmp:
   root=Path(tmp);(root/'old.json').write_text(json.dumps({'phase':'submitted','batch_id':'already-paid'}))
   with self.assertRaisesRegex(ValueError,'no new generation'):identity.request_state_path(root,{'account':'a'},{'batchName':'new','prompts':['wave']},output_root=root/'output')
if __name__=='__main__':unittest.main()
