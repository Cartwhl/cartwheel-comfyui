"""HTTPS transport restricted to publicly routable destinations."""
from contextlib import asynccontextmanager
import ipaddress
import socket
from urllib.parse import urlsplit

import aiohttp

MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024  # Per asset; streaming enforces the limit too.


def public_address(value):
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    return address.is_global and not address.is_multicast


def validate_asset_url(url):
    if not isinstance(url, str) or not url or len(url) > 32768 or any(ord(c) < 33 for c in url):
        raise ValueError("Cartwheel returned an invalid asset URL; HTTPS is required.")
    try:
        parsed = urlsplit(url)
        host = parsed.hostname
        if parsed.scheme != "https" or not host or parsed.username or parsed.password or parsed.fragment or parsed.port not in {None, 443}:
            raise ValueError()
        host = host.rstrip('.').lower()
        if '%' in host or host == 'localhost' or host.endswith(('.localhost', '.local', '.internal')):
            raise ValueError()
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            # DNS names are checked again at connection time by PublicResolver.
            if '.' not in host:
                raise ValueError()
        else:
            if not public_address(address):
                raise ValueError()
    except (ValueError, TypeError):
        raise ValueError("Cartwheel asset URLs must use public HTTPS destinations on port 443.") from None


class PublicResolver(aiohttp.abc.AbstractResolver):
    def __init__(self):
        self.delegate = aiohttp.resolver.DefaultResolver()

    async def resolve(self, host, port=0, family=socket.AF_INET):
        addresses = await self.delegate.resolve(host, port, family)
        if not addresses or any(not public_address(item['host']) for item in addresses):
            raise OSError("Cartwheel connections require publicly routable destinations.")
        return addresses

    async def close(self):
        await self.delegate.close()


@asynccontextmanager
async def api_session():
    # aiohttp resolves numeric IP hosts without invoking a custom resolver;
    # validate_asset_url rejects private literals before a storage request.
    # API requests have one fixed, public hostname.
    resolver = PublicResolver()
    try:
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=60),
            connector=aiohttp.TCPConnector(resolver=resolver),
            trust_env=False,
        ) as session:
            yield session
    finally:
        await resolver.close()
