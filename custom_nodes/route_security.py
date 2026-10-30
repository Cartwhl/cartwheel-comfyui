"""Reject cross-site calls to local Cartwheel routes; not a hosted auth layer."""
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import web


def same_origin(request):
    if request.headers.get('Sec-Fetch-Site') == 'cross-site':
        raise web.HTTPForbidden(text='Cross-site Cartwheel requests are not allowed.')
    origin = request.headers.get('Origin')
    if origin is None:
        return  # CLI/local server calls have no browser Origin.
    try:
        parsed = urlsplit(origin)
        # Compare URL authorities, including ports. Never echo an untrusted Origin.
        if parsed.scheme not in {'http', 'https'} or parsed.scheme != request.scheme or parsed.netloc.lower() != request.host.lower() or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ValueError()
    except ValueError:
        raise web.HTTPForbidden(text='Cross-site Cartwheel requests are not allowed.') from None


def upload_directory(input_directory, name):
    base = Path(input_directory).resolve()
    root = base / name
    root.mkdir(parents=True, exist_ok=True)
    root = root.resolve()
    if not root.is_relative_to(base):
        raise ValueError("Uploads must stay inside the ComfyUI input folder.")
    return root
