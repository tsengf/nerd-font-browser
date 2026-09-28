import io
import json
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from http.server import ThreadingHTTPServer

import server


class CatalogTests(unittest.TestCase):
    def test_every_catalog_font_has_measured_metadata(self):
        measured = server.metadata()
        self.assertEqual(set(server.FONTS), set(measured))
        for identifier, values in measured.items():
            with self.subTest(font=identifier):
                self.assertIsInstance(values["serif"], bool)
                self.assertGreater(values["glyphCount"], 0)
                self.assertGreater(values["heightEm"], 0)

    def test_font_selection_prefers_regular_mono(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("Family/Family-Bold.ttf", b"bold")
            archive.writestr("Family/Family-Regular.ttf", b"regular")
            archive.writestr("Family/FamilyMono-Regular.ttf", b"mono")
        data.seek(0)
        with zipfile.ZipFile(data) as archive:
            self.assertEqual(server.choose_font(archive).filename,
                             "Family/FamilyMono-Regular.ttf")


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.httpd.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    def test_catalog_and_frontend_are_served(self):
        with urllib.request.urlopen(self.base + "/api/catalog") as response:
            data = json.load(response)
        self.assertEqual(len(data["fonts"]), len(server.FONTS))
        self.assertEqual(set(data["metadata"]), set(server.FONTS))
        with urllib.request.urlopen(self.base + "/") as response:
            self.assertIn(b"Nerd Font Browser", response.read())

    def test_unknown_font_is_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(self.base + "/api/font/not-a-font")
        self.assertEqual(error.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
