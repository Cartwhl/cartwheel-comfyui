"""Local-only estimate. No provider/token-count calls and no hidden retry budget.

Rates are the installed native Comfy price badges audited 2026-10-28 (USD per
million tokens). Allow for uncached/cache-write billing and tokenizer uncertainty.
Prices are informational; there is no dollar cap. Token and output limits remain.
"""
import math
from functools import lru_cache

BUDGET_USD = None
MAX_OUTPUT_TOKENS = 8192


def model_rates(provider,model):
    name=model.lower()
    if provider=='openai':
        for key,rates in [('gpt-6-astra',(14.3,71.5)),('gpt-6-sol',(2.86,14.3)),('gpt-6-luna',(.143,.715)),('o4-mini',(1.1,4.4)),('o1-pro',(150,600)),('o1',(15,60)),('o3-mini',(1.1,4.4)),('o3',(10,40)),('gpt-4.1-nano',(.1,.4)),('gpt-4.1-mini',(.4,1.6)),('gpt-4.1',(2,8)),('gpt-5.6-terra',(2.5,15)),('gpt-5.6-luna',(1,6)),('gpt-5.6',(5,30)),('gpt-5.5-pro',(30,180)),('gpt-5.5',(5,30)),('gpt-5-nano',(.05,.4)),('gpt-5-mini',(.25,2)),('gpt-5',(1.25,10))]:
            if name==key or name.startswith(key+'-'):return rates
    if provider=='anthropic':
        for key,rates in [('fable',(14.3,71.5)),('opus 4.8',(7.15,35.75)),('sonnet 5',(2.86,14.3)),('opus 5.5',(5.72,28.6)),('opus 5',(7.15,35.75)),('opus',(5,25)),('sonnet',(3,15)),('haiku',(1,5))]:
            if key in name:return rates
    if provider=='gemini':
        return {'Gemini 3.8 Flash':(2.145,10.725),'Gemini 3.7 Flash':(2.145,10.725),'Gemini 3.1 Pro':(2,12),'Gemini 3.5 Flash':(1.5,9),'Gemini 3.1 Flash-Lite':(.25,1.5)}.get(model)
    return None


@lru_cache(maxsize=1)
def tokenizer():
    try:
        import tiktoken
        return tiktoken.get_encoding('o200k_base')
    except Exception:
        raise ValueError('The local camera token counter is unavailable. Install this node’s requirements and restart ComfyUI. No model request was sent.') from None


def review_budget(model,system,prompt):
    rates=model_rates(model['provider'],model['model'])
    if rates is None:raise ValueError('This model has no verified local price estimate. Choose another model. No model request was sent.')
    tokens=len(tokenizer().encode(system+'\n'+prompt,disallowed_special=()))
    # o200k is an estimate for GPT-6 and other providers, not their exact billing tokenizer.
    input_tokens=math.ceil(tokens*(1.08 if model['provider']=='openai' else 1.30))+512
    # Covers input plus cache-write at conservative native badge rates; no cache discount assumed.
    input_cost=input_tokens*rates[0]*2.25/1_000_000
    # Do not enter long-context price tiers, even for adapters advertising large contexts.
    if input_tokens+MAX_OUTPUT_TOKENS>120_000:raise ValueError('This compact scene exceeds the single-request token allowance. Use a shorter scene. No model request was sent.')
    cap=MAX_OUTPUT_TOKENS
    total=(input_cost+cap*rates[1]/1_000_000)*1.10
    return {'estimated_ceiling_usd':round(total,4),'budget_usd':BUDGET_USD,'input_tokens_estimate':input_tokens,'max_output_tokens':cap,'model_calls':1,'tokenizer':'o200k_base estimate with headroom','pricing_basis':'Native Comfy price badges audited 2026-10-28; uncached/cache-write allowance and 10% cost headroom','billing_note':'Estimate only; no dollar cap. Comfy determines the final charge; this is not a reserved billing cap.'}
