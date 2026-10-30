#!/usr/bin/env python3
"""Serve m2-megamix on localhost.

The repo is served as it is, and /roms/<set>.zip is read in place from
$ROMS_DIR (default ~/build/mameroms) for the three sets the game loads;
nothing else under /roms is served. /shenmue/<path> is one of the eight
files Ryo and Chai are read from (js/shenmue/ryo.js, js/shenmue/chai.js), read off the Shenmue beta's
GD-ROM in $SHENMUE_DIR (default ~/source/repos/ai/SHENMUE 1 BETA 0.400 DISC
3 PERFECT DUMP) by tools/sources/shenmue-fight.py; without the disc it is a 404 and
the roster goes without them. The port is the first argument, or a free one;
the URL is printed. --open also opens it in a Chrome window of its own, with
software WebGL, and stops serving when that window closes; when the port is
already served, it only opens the window.
"""
import http.server
import importlib.util
import os
import shutil
import socket
import subprocess
import sys
import threading
import webbrowser
from functools import partial

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROMS = os.environ.get('ROMS_DIR') or os.path.expanduser('~/build/mameroms')
SETS = {'vf2.zip', 'fvipers.zip', 'sfight.zip'}
SHENMUE = os.environ.get('SHENMUE_DIR') or os.path.expanduser('~/source/repos/ai/SHENMUE 1 BETA 0.400 DISC 3 PERFECT DUMP')
SHENMUE_FILES = {'MISC/MODELS.PKS', 'MISC/MODELS.PKF', 'MISC/MOTION.BIN', 'SCENE/03/MFBT/EN_RYOU.BIN',
                 # Chai's (js/shenmue/chai.js): the ending's fight
                 'SCENE/03/MEND/MODELS.PKS', 'SCENE/03/MEND/MODELS.PKF', 'SCENE/03/MEND/M_FGT4.BIN', 'SCENE/03/MEND/EN_CHAI2.BIN'}


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


def open_browser(url):
    """A Chrome window of its own, with software WebGL (the container's desktop
    has no GPU, and its Chrome makes no WebGL context); returns the process, or
    None when the system browser was asked instead."""
    chrome = shutil.which('google-chrome') or shutil.which('chromium')
    if not chrome:
        webbrowser.open(url)
        return None
    cache = os.environ.get('XDG_CACHE_HOME') or os.path.expanduser('~/.cache')
    return subprocess.Popen([chrome, f'--user-data-dir={cache}/m2-megamix/chrome',
                             '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                             '--no-first-run', '--no-default-browser-check', '--disable-background-mode',
                             f'--app={url}'])


def main():
    args = [a for a in sys.argv[1:] if a != '--open']
    port = int(args[0]) if args else free_port()
    url = f'http://127.0.0.1:{port}/'
    try:
        httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=ROOT))
    except OSError:
        if '--open' not in sys.argv:
            raise
        # Already served (an earlier launch): just open it.
        open_browser(url)
        return
    print(url, flush=True)
    if '--open' not in sys.argv:
        httpd.serve_forever()
        return
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    browser = open_browser(url)
    if browser:
        browser.wait()          # the window closed: stop serving
    else:
        threading.Event().wait()

if __name__ == '__main__':
    main()
