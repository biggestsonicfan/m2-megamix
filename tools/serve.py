#!/usr/bin/env python3
"""Serve m2-megamix on localhost.

The repo is served as it is, and /roms/<set>.zip is read in place from
$ROMS_DIR (default ~/build/mameroms) for the three sets the game loads;
nothing else under /roms is served. The port is the first argument, or a
free one; the URL is printed.
"""
import http.server
import os
import socket
import sys
from functools import partial

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROMS = os.environ.get('ROMS_DIR') or os.path.expanduser('~/build/mameroms')
SETS = {'vf2.zip', 'fvipers.zip', 'sfight.zip'}


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        clean = path.split('?', 1)[0].split('#', 1)[0]
        if clean.startswith('/roms/'):
            name = clean[len('/roms/'):]
            return os.path.join(ROMS, name) if name in SETS else os.path.join(ROMS, '.not-served')
        return super().translate_path(path)

    def do_PUT(self):
        self.send_error(405)
    do_POST = do_DELETE = do_PUT

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else free_port()
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=ROOT))
    print(f'http://127.0.0.1:{port}/', flush=True)
    httpd.serve_forever()


if __name__ == '__main__':
    main()
