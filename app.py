import base64
import os
from flask import Flask, render_template, request, jsonify
from reader.engine import BarcodeEngine

app = Flask(__name__)
# Max upload size: 32MB (suitable for high-res modem photos)
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/status", methods=["GET"])
def status():
    """Check if barcode engine is ready."""
    availability = BarcodeEngine.is_available()
    all_ready = all(availability.values())
    return jsonify({
        "ready": all_ready,
        "status": "online" if all_ready else "offline"
    })


@app.after_request
def add_cache_headers(response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.route("/api/scan", methods=["POST"])
def scan_barcode():
    """
    Scans barcodes from uploaded image.
    Supports:
    1. multipart/form-data with 'file' field
    2. JSON payload with base64 encoded 'image'
    3. Raw binary image in request body
    """
    image_bytes = None
    aggressive = request.args.get("aggressive", "true").lower() in ("true", "1", "yes")

    # 1. Check multipart/form-data
    if "file" in request.files:
        uploaded_file = request.files["file"]
        if uploaded_file.filename != "":
            image_bytes = uploaded_file.read()

    # 2. Check JSON with base64
    elif request.is_json:
        data = request.get_json() or {}
        img_b64 = data.get("image", "")
        if img_b64:
            if "," in img_b64:
                img_b64 = img_b64.split(",", 1)[1]
            try:
                image_bytes = base64.b64decode(img_b64)
            except Exception as e:
                return jsonify({"success": False, "error": f"Invalid base64: {str(e)}"}), 400

    # 3. Check raw body
    elif request.data:
        image_bytes = request.data

    if not image_bytes:
        return jsonify({
            "success": False,
            "error": "Tidak ada file gambar yang dikirim. Kirimkan form 'file' atau JSON 'image' base64."
        }), 400

    # Save last uploaded image for debug / inspection
    try:
        with open("last_scan.jpg", "wb") as f:
            f.write(image_bytes)
    except Exception:
        pass

    result = BarcodeEngine.decode_from_bytes(image_bytes, aggressive=aggressive)
    print(f"[SCAN] Found: {result.get('count', 0)} barcode(s) in {result.get('time_ms', 0)}ms")
    status_code = 200 if result.get("success") else 500
    return jsonify(result), status_code


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"Barcode Reader Service running on http://127.0.0.1:{port}")
    app.run(host="0.0.0.0", port=port, debug=True)
