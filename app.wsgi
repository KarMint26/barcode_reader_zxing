import os
import sys

# Dapatkan path direktori proyek secara otomatis & dinamis dari lokasi file wsgi ini
root = os.path.dirname(os.path.abspath(__file__))
if root not in sys.path:
    sys.path.insert(0, root)

# Opsional: Jika menggunakan virtualenv di dalam folder proyek (.venv), aktifkan otomatis
venv_activate_unix = os.path.join(root, ".venv", "bin", "activate_this.py")
if os.path.exists(venv_activate_unix):
    with open(venv_activate_unix) as f:
        exec(f.read(), dict(__file__=venv_activate_unix))

# Import instance Flask dan expose sebagai 'application' untuk WSGI server
from app import app as application

if __name__ == "__main__":
    application.run()
