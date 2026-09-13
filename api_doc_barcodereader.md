# 📡 API Documentation — Ultra Barcode Reader Service

Dokumentasi integrasi REST API untuk layanan pembaca barcode otomatis (Serial Number, MAC Address, PON SN modem ONT, QR Code, dan barcode 1D/2D lainnya).

---

## 🌐 Endpoint URL

- **Production URL:** `https://barcode-read.app-hallonet.my.id/api/scan`
- **Method:** `POST`
- **Accepted Formats:** 
  1. `multipart/form-data` (Upload file foto langsung — **Direkomendasikan**)
  2. `application/json` (Base64 string)

---

## 📥 Parameter Request

| Parameter | Tipe | Wajib? | Deskripsi |
| :--- | :--- | :--- | :--- |
| `file` | File | Ya* | File foto stiker barcode (JPG, JPEG, PNG, WebP). *(Wajib jika via multipart)* |
| `image` | String (Base64) | Ya* | Data Base64 gambar. *(Wajib jika via JSON)* |
| `aggressive` | Boolean / String | Tidak | Default `true`. Mengaktifkan auto-enhancement (anti-glare, blur fix, adaptive scaling). |

---

## 💻 Contoh Penggunaan (Code Snippets)

### 1. cURL (Terminal / Bash)

```bash
curl -X POST \
  -F "file=@/path/ke/foto_modem.jpg" \
  https://barcode-read.app-hallonet.my.id/api/scan
```

---

### 2. PHP (cURL Native)

Cocok untuk integrasi ke sistem billing, registrasi OLT, atau sistem teknisi lapangan berbasis PHP:

```php
<?php

$apiUrl = 'https://barcode-read.app-hallonet.my.id/api/scan';
$imagePath = '/path/ke/foto_modem.jpg';

$ch = curl_init();

$postData = [
    'file' => new CURLFile($imagePath, mime_content_type($imagePath), basename($imagePath))
];

curl_setopt_array($ch, [
    CURLOPT_URL => $apiUrl,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $postData,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_SSL_VERIFYPEER => true
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode === 200) {
    $result = json_decode($response, true);
    if ($result['success'] && $result['count'] > 0) {
        foreach ($result['barcodes'] as $barcode) {
            echo "Format: " . $barcode['format'] . "\n";
            echo "Nilai : " . $barcode['text'] . "\n";
        }
    } else {
        echo "Tidak ada barcode yang terdeteksi.\n";
    }
} else {
    echo "Gagal menghubungi API. HTTP Code: " . $httpCode . "\n";
}
```

---

### 3. Python (`requests`)

```python
import requests

url = "https://barcode-read.app-hallonet.my.id/api/scan"
file_path = "foto_modem.jpg"

with open(file_path, "rb") as f:
    files = {"file": (file_path, f, "image/jpeg")}
    response = requests.post(url, files=files)

data = response.json()

if data.get("success") and data.get("count", 0) > 0:
    for item in data["barcodes"]:
        print(f"[{item['format']}] {item['text']}")
else:
    print("Barcode tidak ditemukan.")
```

---

### 4. JavaScript / Node.js (`fetch`)

```javascript
// Menggunakan FormData di Browser atau Node.js 18+
const formData = new FormData();
formData.append("file", fileInputElement.files[0]);

fetch("https://barcode-read.app-hallonet.my.id/api/scan", {
  method: "POST",
  body: formData
})
  .then(res => res.json())
  .then(data => {
    if (data.success && data.count > 0) {
      data.barcodes.forEach(b => {
        console.log(`Format: ${b.format}, Text: ${b.text}`);
      });
    } else {
      console.log("Tidak ada barcode terdeteksi.");
    }
  })
  .catch(err => console.error("Error:", err));
```

---

## 📤 Contoh Response JSON

### Response Berhasil (Barcode Ditemukan)
```json
{
  "success": true,
  "count": 1,
  "time_ms": 69.19,
  "image_size": {
    "width": 1280,
    "height": 720
  },
  "barcodes": [
    {
      "text": "48575443F3BF3BB9",
      "huawei_sn": "HWTCF3BF3BB9",
      "is_huawei": true,
      "gpon_sn": "HWTCF3BF3BB9",
      "format": "Code128",
      "orientation": 0,
      "stage": "Stage 3: Upscale 2.0x",
      "bounds": {
        "x": 120,
        "y": 240,
        "width": 450,
        "height": 85
      },
      "polygon": [
        {"x": 120, "y": 240},
        {"x": 570, "y": 240},
        {"x": 570, "y": 325},
        {"x": 120, "y": 325}
      ]
    }
  ]
}
```

### Response Kosong (Tidak Ada Barcode Terdeteksi)
```json
{
  "success": true,
  "count": 0,
  "time_ms": 35.4,
  "image_size": {
    "width": 800,
    "height": 600
  },
  "barcodes": []
}
```

---

## 📋 Penjelasan Field Response

- **`success`** *(boolean)*: `true` jika proses pemindaian berjalan lancar.
- **`count`** *(integer)*: Jumlah barcode unik yang berhasil dibaca dari foto.
- **`time_ms`** *(float)*: Durasi waktu eksekusi proses pembacaan dalam milidetik.
- **`barcodes`** *(array)*: Daftar barcode yang ditemukan:
  - **`text`** *(string)*: Nilai data asli mentah barcode (misal: `"48575443F3BF3BB9"`).
  - **`huawei_sn`** *(string, opsional)*: Nilai Serial Number format Huawei (`"HWTCF3BF3BB9"`). Muncul otomatis jika barcode adalah SN modem 16-digit.
  - **`is_huawei`** *(boolean, opsional)*: Bernilai `true` jika terdeteksi modem Huawei (`48575443...`).
  - **`gpon_sn`** *(string, opsional)*: Format vendor GPON (`HWTC...`, `ZTEG...`, `FHTC...`, `ALCL...`).
  - **`format`** *(string)*: Jenis barcode (`Code128`, `Code39`, `QRCode`, `EAN13`, dll.).
  - **`bounds`** *(object)*: Koordinat kotak pembatas pada foto asli (`x`, `y`, `width`, `height`).
  - **`polygon`** *(array)*: 4 titik koordinat sudut barcode.
