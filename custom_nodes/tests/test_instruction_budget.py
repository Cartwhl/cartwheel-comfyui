import importlib,sys,types,unittest
from pathlib import Path
from unittest.mock import patch
pkg=types.ModuleType('instruction_budget_test');pkg.__path__=[str(Path(__file__).resolve().parents[1])];sys.modules[pkg.__name__]=pkg
budget=importlib.import_module(pkg.__name__+'.instruction_budget')
class BudgetTests(unittest.TestCase):
    def test_small_medium_and_too_large_requests(self):
        model={'provider':'openai','model':'gpt-6-sol'}
        small=budget.review_budget(model,'system','user');self.assertEqual(small['model_calls'],1);self.assertIsNone(small['budget_usd']);self.assertEqual(small['max_output_tokens'],8192)
        encoder=types.SimpleNamespace(encode=lambda *a,**k:[0]*50000)
        with patch.object(budget,'tokenizer',return_value=encoder):
            medium=budget.review_budget(model,'s','p');self.assertIsNone(medium['budget_usd']);self.assertEqual(medium['max_output_tokens'],8192)
            expensive=budget.review_budget({'provider':'openai','model':'gpt-6-astra'},'s','p');self.assertGreater(expensive['estimated_ceiling_usd'],.5);self.assertEqual(expensive['max_output_tokens'],8192)
        with patch.object(budget,'tokenizer',return_value=types.SimpleNamespace(encode=lambda *a,**k:[0]*200000)):
            with self.assertRaisesRegex(ValueError,'token allowance'):budget.review_budget(model,'s','p')
    def test_unknown_prices_and_missing_counter_fail_closed(self):
        with self.assertRaisesRegex(ValueError,'verified local price'):budget.review_budget({'provider':'seed','model':'anything'},'s','p')
        with patch.object(budget,'tokenizer',side_effect=ValueError('counter unavailable')):
            with self.assertRaises(ValueError):budget.review_budget({'provider':'openai','model':'gpt-6-sol'},'s','p')
    def test_cost_accounts_for_worst_case_output_and_cache_write(self):
        model={'provider':'openai','model':'gpt-6-sol'};r=budget.review_budget(model,'s','1,2,3 '*500)
        expected=(r['input_tokens_estimate']*2.86*2.25+r['max_output_tokens']*14.3)/1e6*1.1
        self.assertAlmostEqual(r['estimated_ceiling_usd'],expected,places=4);self.assertIn('not a reserved billing cap',r['billing_note'])
if __name__=='__main__':unittest.main()
