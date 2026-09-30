"""PyInstaller-Einstieg (absolute Importe, da __main__.py im Paket liegt)."""

import sys

from transcripter.__main__ import main

if __name__ == "__main__":
    sys.exit(main())
