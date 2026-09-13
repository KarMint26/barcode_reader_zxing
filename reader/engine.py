import io
import time
from typing import List, Dict, Any, Optional
import numpy as np
from PIL import Image, ImageOps

try:
    import cv2
except ImportError:
    cv2 = None

try:
    import zxingcpp
except ImportError:
    zxingcpp = None


def parse_gpon_sn(text: str) -> Optional[str]:
    """
    Converts 16-digit hex GPON Serial Numbers (e.g. 48575443F3BF3BB9)
    to Vendor Prefix format (e.g. HWTCF3BF3BB9).
    First 8 hex digits (4 bytes) are ASCII vendor ID (48575443 -> 'HWTC').
    """
    clean = text.strip().upper()
    if len(clean) == 16 and all(c in "0123456789ABCDEF" for c in clean):
        try:
            vendor_hex = clean[:8]
            vendor_ascii = bytes.fromhex(vendor_hex).decode("ascii", errors="ignore")
            if len(vendor_ascii) == 4 and vendor_ascii.isalnum():
                return f"{vendor_ascii}{clean[8:]}"
        except Exception:
            pass
    return None


class BarcodeEngine:
    """
    Ultra-resilient Barcode Reader using zxing-cpp + multi-stage OpenCV preprocessing
    specially designed for challenging 1D & 2D barcodes (ONT modem stickers, glossy labels,
    glare, lens blur, tight crops, and low-contrast labels).
    """

    @staticmethod
    def is_available() -> Dict[str, bool]:
        return {
            "zxingcpp": zxingcpp is not None,
            "cv2": cv2 is not None
        }

    @classmethod
    def decode_from_bytes(cls, image_bytes: bytes, aggressive: bool = True) -> Dict[str, Any]:
        start_time = time.perf_counter()

        if zxingcpp is None:
            return {
                "success": False,
                "error": "zxing-cpp belum terinstall. Jalankan: pip install zxing-cpp",
                "count": 0,
                "barcodes": [],
                "time_ms": 0
            }

        # 1. Load image using Pillow with EXIF orientation handling
        try:
            pil_image = Image.open(io.BytesIO(image_bytes))
            pil_image = ImageOps.exif_transpose(pil_image)
            pil_image = pil_image.convert("RGB")
        except Exception as e:
            return {
                "success": False,
                "error": f"Gagal membaca file gambar: {str(e)}",
                "count": 0,
                "barcodes": [],
                "time_ms": 0
            }

        img_width, img_height = pil_image.size
        rgb_np = np.array(pil_image)
        gray = cv2.cvtColor(rgb_np, cv2.COLOR_RGB2GRAY) if cv2 is not None else None

        detected_map: Dict[str, Dict[str, Any]] = {}

        def add_barcodes(barcodes_found, stage_name: str, transform_coords=None):
            for b in barcodes_found:
                if not b.text:
                    continue
                format_name = str(b.format).split('.')[-1]
                key = f"{format_name}:{b.text}"
                if key not in detected_map:
                    pos = b.position
                    pts = [
                        {"x": int(pos.top_left.x), "y": int(pos.top_left.y)},
                        {"x": int(pos.top_right.x), "y": int(pos.top_right.y)},
                        {"x": int(pos.bottom_right.x), "y": int(pos.bottom_right.y)},
                        {"x": int(pos.bottom_left.x), "y": int(pos.bottom_left.y)}
                    ]

                    if transform_coords:
                        pts = transform_coords(pts)

                    xs = [p["x"] for p in pts]
                    ys = [p["y"] for p in pts]
                    min_x = max(0, min(xs))
                    min_y = max(0, min(ys))
                    max_x = min(img_width, max(xs))
                    max_y = min(img_height, max(ys))

                    item_data = {
                        "text": b.text,
                        "format": format_name,
                        "orientation": getattr(b, 'orientation', 0),
                        "stage": stage_name,
                        "polygon": pts,
                        "bounds": {
                            "x": min_x,
                            "y": min_y,
                            "width": max(1, max_x - min_x),
                            "height": max(1, max_y - min_y)
                        }
                    }
                    gpon = parse_gpon_sn(b.text)
                    if gpon:
                        item_data["gpon_sn"] = gpon
                        item_data["huawei_sn"] = gpon
                        item_data["is_huawei"] = gpon.startswith("HWTC")

                    detected_map[key] = item_data

        def try_decode(img_input, stage_name: str, transform_coords=None):
            """Scans with both LocalAverage and GlobalHistogram binarizers."""
            try:
                res1 = zxingcpp.read_barcodes(
                    img_input,
                    try_rotate=True,
                    try_downscale=True,
                    try_invert=True,
                    binarizer=zxingcpp.Binarizer.LocalAverage
                )
                add_barcodes(res1, stage_name, transform_coords)
            except Exception:
                pass

            if len(detected_map) == 0:
                try:
                    res2 = zxingcpp.read_barcodes(
                        img_input,
                        try_rotate=True,
                        try_downscale=True,
                        try_invert=True,
                        binarizer=zxingcpp.Binarizer.GlobalHistogram
                    )
                    add_barcodes(res2, f"{stage_name} (GlobalHist)", transform_coords)
                except Exception:
                    pass

        # =======================================================
        # STAGE 1: Direct Scan on PIL Image and Grayscale
        # =======================================================
        try_decode(pil_image, "Stage 1: Direct PIL")
        if gray is not None and len(detected_map) == 0:
            try_decode(gray, "Stage 1: Direct Gray")

        # =======================================================
        # STAGE 2: White Padding (Quiet Zone Injection)
        # In barcode standards, a 10X quiet zone (white space) on
        # both edges is strictly required. Tight crops cut this off!
        # =======================================================
        if gray is not None and len(detected_map) == 0:
            pad_x = max(40, int(img_width * 0.15))
            pad_y = max(25, int(img_height * 0.15))
            padded_gray = cv2.copyMakeBorder(gray, pad_y, pad_y, pad_x, pad_x, cv2.BORDER_CONSTANT, value=255)

            def unpad_coords(pts):
                return [{"x": max(0, min(img_width, p["x"] - pad_x)),
                         "y": max(0, min(img_height, p["y"] - pad_y))} for p in pts]

            try_decode(padded_gray, "Stage 2: Quiet Zone Padded", unpad_coords)

        # =======================================================
        # STAGE 3: Upscaling for Cropped or Low-Resolution Barcodes
        # If barcode height is < 250px or width < 800px, 1D bars
        # are often only 1 pixel wide and blur together.
        # =======================================================
        if gray is not None and cv2 is not None and len(detected_map) == 0:
            if img_height < 250 or img_width < 700:
                for scale_factor in [2.0, 3.0]:
                    if len(detected_map) > 0:
                        break
                    up_w = int(img_width * scale_factor)
                    up_h = int(img_height * scale_factor)
                    upscaled = cv2.resize(gray, (up_w, up_h), interpolation=cv2.INTER_CUBIC)
                    # Add quiet zone to upscaled image too
                    pad_u_x = int(50 * scale_factor)
                    pad_u_y = int(30 * scale_factor)
                    upscaled_pad = cv2.copyMakeBorder(upscaled, pad_u_y, pad_u_y, pad_u_x, pad_u_x,
                                                      cv2.BORDER_CONSTANT, value=255)

                    def make_unscale_func(sf, px, py):
                        return lambda pts: [
                            {"x": max(0, min(img_width, int((p["x"] - px) / sf))),
                             "y": max(0, min(img_height, int((p["y"] - py) / sf)))}
                            for p in pts
                        ]

                    try_decode(upscaled_pad, f"Stage 3: Upscale {scale_factor}x",
                               make_unscale_func(scale_factor, pad_u_x, pad_u_y))

        # =======================================================
        # STAGE 4: OpenCV Advanced Preprocessing (CLAHE, Blur Fix, Otsu)
        # =======================================================
        if aggressive and gray is not None and cv2 is not None and len(detected_map) == 0:
            # 4.1 Contrast & Glare: CLAHE
            try:
                clahe = cv2.createCLAHE(clipLimit=3.5, tileGridSize=(8, 8))
                enhanced_clahe = clahe.apply(gray)
                try_decode(enhanced_clahe, "Stage 4.1: CLAHE (Anti-Glare)")

                # CLAHE with padding
                pad_clahe = cv2.copyMakeBorder(enhanced_clahe, 30, 30, 50, 50, cv2.BORDER_CONSTANT, value=255)
                try_decode(pad_clahe, "Stage 4.1: CLAHE + Padded",
                           lambda pts: [{"x": max(0, min(img_width, p["x"] - 50)),
                                         "y": max(0, min(img_height, p["y"] - 30))} for p in pts])
            except Exception:
                pass

            # 4.2 Lens Blur Fix: Unsharp Mask & 1D Horizontal Edge Filter
            if len(detected_map) == 0:
                try:
                    blurred = cv2.GaussianBlur(gray, (0, 0), 2.5)
                    sharpened = cv2.addWeighted(gray, 2.2, blurred, -1.2, 0)
                    pad_sharp = cv2.copyMakeBorder(sharpened, 30, 30, 50, 50, cv2.BORDER_CONSTANT, value=255)
                    try_decode(pad_sharp, "Stage 4.2: Sharpened + Padded",
                               lambda pts: [{"x": max(0, min(img_width, p["x"] - 50)),
                                             "y": max(0, min(img_height, p["y"] - 30))} for p in pts])
                except Exception:
                    pass

            # 4.3 Otsu Binarization & Adaptive Gaussian
            if len(detected_map) == 0:
                try:
                    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
                    pad_otsu = cv2.copyMakeBorder(otsu, 30, 30, 50, 50, cv2.BORDER_CONSTANT, value=255)
                    try_decode(pad_otsu, "Stage 4.3: Otsu Binarization",
                               lambda pts: [{"x": max(0, min(img_width, p["x"] - 50)),
                                             "y": max(0, min(img_height, p["y"] - 30))} for p in pts])

                    adaptive = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                                     cv2.THRESH_BINARY, 21, 5)
                    pad_adapt = cv2.copyMakeBorder(adaptive, 30, 30, 50, 50, cv2.BORDER_CONSTANT, value=255)
                    try_decode(pad_adapt, "Stage 4.3: Adaptive Gaussian",
                               lambda pts: [{"x": max(0, min(img_width, p["x"] - 50)),
                                             "y": max(0, min(img_height, p["y"] - 30))} for p in pts])
                except Exception:
                    pass

            # 4.4 OpenCV BarcodeDetector Quadrangle ROI Rectification
            if len(detected_map) == 0 and hasattr(cv2, 'barcode'):
                try:
                    bd = cv2.barcode.BarcodeDetector()
                    ok, corners = bd.detect(gray)
                    if ok and corners is not None and len(corners) > 0:
                        pts_roi = corners[0].astype(np.float32)
                        rw = int(max(np.linalg.norm(pts_roi[0] - pts_roi[3]), np.linalg.norm(pts_roi[1] - pts_roi[2])))
                        rh = int(max(np.linalg.norm(pts_roi[0] - pts_roi[1]), np.linalg.norm(pts_roi[3] - pts_roi[2])))
                        if rw > 30 and rh > 10:
                            dst = np.array([[0, rh], [0, 0], [rw, 0], [rw, rh]], dtype=np.float32)
                            M = cv2.getPerspectiveTransform(pts_roi, dst)
                            warped = cv2.warpPerspective(gray, M, (rw, rh))
                            warped_pad = cv2.copyMakeBorder(warped, 30, 30, 60, 60, cv2.BORDER_CONSTANT, value=255)
                            try_decode(warped_pad, "Stage 4.4: Geometry Rectified")
                except Exception:
                    pass

        # =======================================================
        # STAGE 5: Downscale if image is gigantic (> 2000px)
        # =======================================================
        if aggressive and gray is not None and len(detected_map) == 0:
            max_dim = max(img_width, img_height)
            if max_dim > 2200:
                scale = 1800.0 / max_dim
                tw, th = int(img_width * scale), int(img_height * scale)
                try:
                    resized = cv2.resize(gray, (tw, th), interpolation=cv2.INTER_AREA)
                    inv_s = 1.0 / scale
                    try_decode(resized, "Stage 5: Downscaled",
                               lambda pts: [{"x": int(p["x"] * inv_s), "y": int(p["y"] * inv_s)} for p in pts])
                except Exception:
                    pass

        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
        results = list(detected_map.values())

        return {
            "success": True,
            "count": len(results),
            "time_ms": elapsed_ms,
            "image_size": {"width": img_width, "height": img_height},
            "barcodes": results
        }
