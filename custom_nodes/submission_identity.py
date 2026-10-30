"""Batch labels organize submissions; they are not generation identity or ownership."""
import hashlib
import json
from pathlib import Path


def request_identity(fields, options, version=0):
    value = {**fields, 'options': {k:v for k,v in options.items() if k != 'batchName'}}
    digest = hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()
    return hashlib.sha256((digest+'\0'+str(version)).encode()).hexdigest() if version else digest


def request_state_path(root, fields, options, *, version=0, output_root=None):
    """Find an old name-sensitive journal using its exact account/options hash.

    Accepted/unknown submissions must survive removing the old naming widget.
    A normalized hash retained in the journal keeps that alias usable afterward.
    """
    root = Path(root)
    identity = request_identity(fields, options, version)
    current = root / f'{identity}.json'
    if current.is_file():
        return current, identity
    unresolved_legacy = False
    for path in sorted(root.glob('*.json')):
        try:
            state = json.loads(path.read_text())
            if not isinstance(state, dict):continue
            if state.get('request_identity') == identity:return path, identity
            if output_root and not state.get('request_identity') and state.get('phase') in {'submitting','submitted'}:
                unresolved_legacy = True
            names = [state.get('batch_name')]
            if output_root and isinstance(state.get('generation_id'), str):
                result = Path(output_root) / state['generation_id'] / 'capture.json'
                if result.resolve().is_relative_to(Path(output_root).resolve()) and result.is_file():
                    names.append(json.loads(result.read_text()).get('generation_options',{}).get('batchName'))
            names += ['Cartwheel Motion'] if output_root else []
            for name in names:
                if not isinstance(name,str):continue
                legacy = hashlib.sha256(json.dumps({**fields,'options':{**options,'batchName':name}},sort_keys=True).encode()).hexdigest()
                if version:legacy=hashlib.sha256((legacy+'\0'+str(version)).encode()).hexdigest()
                if path.stem == legacy:return path, identity
        except (OSError, ValueError, TypeError):
            continue
    if unresolved_legacy:
        raise ValueError('A pre-upgrade Swing Choreo request is still pending and its old name cannot be verified. Ask the service-key owner to recover that request before submitting again; no new generation was sent.')
    return current, identity
