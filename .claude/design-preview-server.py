"""Static server for the design preview of the main checkout (branch develop), with caching turned off.

Every response carries `Cache-Control: no-store`, so the browser always loads the files as they are on disk.
Run by the `design-preview-develop` entry of the launch.json one folder above the repository, which also rebuilds
preview.compiled.css on every change.
"""

import functools
import http.server
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps", "web", "design-preview")
PORT = 4190


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


class PreviewServer(http.server.ThreadingHTTPServer):
    # The page loads about 60 ES modules at once; the default queue of 5 resets connections under that burst
    request_queue_size = 256
    daemon_threads = True


if __name__ == "__main__":
    handler = functools.partial(NoCacheHandler, directory=os.path.abspath(ROOT))
    with PreviewServer(("localhost", PORT), handler) as server:
        server.serve_forever()
