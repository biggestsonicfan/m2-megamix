#!/usr/bin/env python3
"""Serve m2-megamix on localhost.

The repo is served as it is, and /roms/<set>.zip is read in place from
$ROMS_DIR (default ~/build/mameroms) for the three sets the game loads;
nothing else under /roms is served. /shenmue/<path> is one of the four
files Ryo is read from (js/ryo.js SHENMUE_FILES), read off the Shenmue beta's
GD-ROM in $SHENMUE_DIR (default ~/source/repos/ai/SHENMUE 1 BETA 0.400 DISC
3 PERFECT DUMP) by tools/shenmue-fight.py; without the disc it is a 404 and
the roster goes without him. The port is the first argument, or a free one;
the URL is printed.
"""
import http.server
import importlib.util
import os
import socket
import sys
from functools import partial

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROMS = os.environ.get('ROMS_DIR') or os.path.expanduser('~/build/mameroms')
SETS = {'vf2.zip', 'fvipers.zip', 'sfight.zip'}
SHENMUE = os.environ.get('SHENMUE_DIR') or os.path.expanduser('~/source/repos/ai/SHENMUE 1 BETA 0.400 DISC 3 PERFECT DUMP')
SHENMUE_FILES = {'MISC/MODELS.PKS', 'MISC/MODELS.PKF', 'MISC/MOTION.BIN', 'SCENE/03/MFBT/EN_RYOU.BIN'}


def shenmue_fight():
    spec = importlib.util.spec_from_file_location('shenmue_fight', os.path.join(ROOT, 'tools', 'shenmue-fight.py'))
    mod = importlib.util.module_from_spec(spec)
    sys.dont_write_bytecode = True
    spec.loader.exec_module(mod)
    return mod


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        clean = path.split('?', 1)[0].split('#', 1)[0]
        if clean.startswith('/roms/'):
            name = clean[len('/roms/'):]
            return os.path.join(ROMS, name) if name in SETS else os.path.join(ROMS, '.not-served')
        return super().translate_path(path)

    def do_GET(self):
        clean = self.path.split('?', 1)[0].split('#', 1)[0]
        if not clean.startswith('/shenmue/'):
            return super().do_GET()
        name = clean[len('/shenmue/'):]
        data = None
        if name in SHENMUE_FILES and os.path.isdir(SHENMUE):
            data = shenmue_fight().read_file(SHENMUE, name)
        if data is None:
            return self.send_error(404)
        self.send_response(200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

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
