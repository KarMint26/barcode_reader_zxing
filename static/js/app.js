/**
 * Ultra Barcode Reader Frontend Controller
 * With Interactive Custom Crop / ROI Selection
 */
document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("fileInput");
  const dropzone = document.getElementById("dropzone");
  const canvasWrapper = document.getElementById("canvasWrapper");
  const canvasBox = document.getElementById("canvasBox");
  const canvas = document.getElementById("previewCanvas");
  const ctx = canvas.getContext("2d");

  const scanOverlay = document.getElementById("scanOverlay");
  const btnChangeImage = document.getElementById("btnChangeImage");
  const btnRescan = document.getElementById("btnRescan");
  const btnToggleCrop = document.getElementById("btnToggleCrop");
  const btnResetCrop = document.getElementById("btnResetCrop");
  const cropBar = document.getElementById("cropBar");
  const btnApplyCrop = document.getElementById("btnApplyCrop");
  const btnCancelCrop = document.getElementById("btnCancelCrop");
  const chkAggressive = document.getElementById("chkAggressive");
  const chkFormatHuawei = document.getElementById("chkFormatHuawei");

  // Converts 16-character hex GPON SN (e.g. 48575443F3BF3BB9) to Vendor format (HWTCF3BF3BB9)
  function parseGponSn(rawText) {
    if (!rawText) return null;
    const clean = rawText.trim().toUpperCase();
    if (clean.length === 16 && /^[0-9A-F]{16}$/.test(clean)) {
      const vendorHex = clean.substring(0, 8);
      let vendorAscii = "";
      for (let i = 0; i < 8; i += 2) {
        vendorAscii += String.fromCharCode(parseInt(vendorHex.substring(i, i + 2), 16));
      }
      if (/^[A-Za-z0-9]{4}$/.test(vendorAscii)) {
        return `${vendorAscii}${clean.substring(8)}`;
      }
    }
    return null;
  }

  const barcodeCount = document.getElementById("barcodeCount");
  const scanTime = document.getElementById("scanTime");
  const resultsList = document.getElementById("resultsList");
  const emptyState = document.getElementById("emptyState");
  const alertBox = document.getElementById("alertBox");
  const engineStatus = document.getElementById("engineStatus");

  // State
  let originalFile = null;
  let originalImage = null;
  let activeFile = null;
  let activeImage = null;
  let isCropped = false;

  let currentBarcodes = [];
  let hoveredBarcodeIndex = -1;

  // Crop State
  let isCropMode = false;
  let isDrawingCrop = false;
  let cropStart = null;
  let cropCurrent = null;
  let selectionRect = null; // { x, y, width, height } in image coordinates

  // 1. Check Engine Health
  async function checkEngineStatus() {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error("HTTP error " + res.status);
      const data = await res.json();

      if (data.ready) {
        engineStatus.innerHTML = `
          <span class="status-dot online"></span>
          <span class="status-text">Engine Ready</span>
        `;
      } else {
        engineStatus.innerHTML = `
          <span class="status-dot" style="background-color: var(--danger)"></span>
          <span class="status-text">Service Initializing...</span>
        `;
      }
    } catch (e) {
      engineStatus.innerHTML = `
        <span class="status-dot" style="background-color: var(--danger)"></span>
        <span class="status-text">Server Offline</span>
      `;
    }
  }
  checkEngineStatus();

  // 2. Drag & Drop and File Selection Handlers
  ["dragenter", "dragover"].forEach(event => {
    dropzone.addEventListener(event, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach(event => {
    dropzone.addEventListener(event, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });

  dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  // 3. Paste from Clipboard (Ctrl + V)
  window.addEventListener("paste", (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const blob = items[i].getAsFile();
        if (blob) {
          handleFile(blob);
          showToast("Gambar berhasil di-paste dari clipboard!");
          break;
        }
      }
    }
  });

  // 4. Action Buttons
  btnChangeImage.addEventListener("click", () => {
    fileInput.value = "";
    originalFile = null;
    originalImage = null;
    activeFile = null;
    activeImage = null;
    isCropped = false;
    currentBarcodes = [];

    exitCropMode();
    btnResetCrop.classList.add("hidden");

    dropzone.classList.remove("hidden");
    canvasWrapper.classList.add("hidden");
    resultsList.innerHTML = "";
    resultsList.appendChild(emptyState);
    barcodeCount.innerText = "0";
    scanTime.innerText = "— ms";
    hideAlert();
  });

  btnRescan.addEventListener("click", () => {
    if (activeFile) {
      processScan(activeFile);
    }
  });

  chkAggressive.addEventListener("change", () => {
    if (activeFile) {
      processScan(activeFile);
    }
  });

  if (chkFormatHuawei) {
    chkFormatHuawei.addEventListener("change", () => {
      if (currentBarcodes && currentBarcodes.length > 0) {
        renderResults(currentBarcodes);
      }
    });
  }

  // 5. File Processing
  function handleFile(file) {
    if (!file.type.startsWith("image/")) {
      showAlert("Harap upload file gambar (JPG, PNG, WebP, dsb.)", "error");
      return;
    }

    originalFile = file;
    activeFile = file;
    isCropped = false;
    btnResetCrop.classList.add("hidden");
    hideAlert();

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        originalImage = img;
        activeImage = img;
        dropzone.classList.add("hidden");
        canvasWrapper.classList.remove("hidden");
        renderCanvas();
        processScan(activeFile);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // 6. Crop / ROI Mode Controllers
  btnToggleCrop.addEventListener("click", () => {
    if (isCropMode) {
      exitCropMode();
    } else {
      enterCropMode();
    }
  });

  btnCancelCrop.addEventListener("click", () => {
    exitCropMode();
  });

  btnResetCrop.addEventListener("click", () => {
    if (originalImage && originalFile) {
      activeImage = originalImage;
      activeFile = originalFile;
      isCropped = false;
      btnResetCrop.classList.add("hidden");
      exitCropMode();
      renderCanvas();
      processScan(activeFile);
      showToast("Tampilan kembali ke foto penuh.");
    }
  });

  function enterCropMode() {
    if (!activeImage) return;
    isCropMode = true;
    btnToggleCrop.classList.add("active");
    cropBar.classList.remove("hidden");
    canvas.classList.add("crop-mode");
    selectionRect = null;
    btnApplyCrop.disabled = true;
    renderCanvas();
  }

  function exitCropMode() {
    isCropMode = false;
    isDrawingCrop = false;
    cropStart = null;
    cropCurrent = null;
    selectionRect = null;
    btnToggleCrop.classList.remove("active");
    cropBar.classList.add("hidden");
    canvas.classList.remove("crop-mode");
    btnApplyCrop.disabled = true;
    renderCanvas();
  }

  // Apply Crop: Extract area and scan
  btnApplyCrop.addEventListener("click", () => {
    if (!selectionRect || selectionRect.width < 15 || selectionRect.height < 15 || !activeImage) {
      return;
    }

    const naturalW = activeImage.naturalWidth || activeImage.width;
    const naturalH = activeImage.naturalHeight || activeImage.height;

    // Add 12% horizontal & 15% vertical safety margin so quiet zone isn't chopped off
    const padX = Math.round(selectionRect.width * 0.12);
    const padY = Math.round(selectionRect.height * 0.15);

    const cropX = Math.max(0, selectionRect.x - padX);
    const cropY = Math.max(0, selectionRect.y - padY);
    const cropW = Math.min(naturalW - cropX, selectionRect.width + (padX * 2));
    const cropH = Math.min(naturalH - cropY, selectionRect.height + (padY * 2));

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = Math.round(cropW);
    cropCanvas.height = Math.round(cropH);
    const cropCtx = cropCanvas.getContext("2d");

    cropCtx.drawImage(
      activeImage,
      Math.round(cropX),
      Math.round(cropY),
      Math.round(cropW),
      Math.round(cropH),
      0,
      0,
      cropCanvas.width,
      cropCanvas.height
    );

    cropCanvas.toBlob((blob) => {
      if (!blob) {
        showAlert("Gagal memotong area gambar.", "error");
        return;
      }

      const croppedImg = new Image();
      croppedImg.onload = () => {
        activeImage = croppedImg;
        activeFile = blob;
        isCropped = true;
        btnResetCrop.classList.remove("hidden");

        exitCropMode();
        renderCanvas();
        processScan(activeFile);
        showToast("Area berhasil dipotong! Memulai scan...");
      };
      croppedImg.src = URL.createObjectURL(blob);
    }, "image/jpeg", 0.95);
  });

  // Canvas Mouse & Touch Coordinate Helper
  function getImageCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let x = (clientX - rect.left) * scaleX;
    let y = (clientY - rect.top) * scaleY;

    x = Math.max(0, Math.min(canvas.width, x));
    y = Math.max(0, Math.min(canvas.height, y));

    return { x, y };
  }

  // Mouse / Touch Events for Drawing Crop Box
  function onCropStart(e) {
    if (!isCropMode || !activeImage) return;
    e.preventDefault();
    isDrawingCrop = true;
    cropStart = getImageCoordinates(e);
    cropCurrent = cropStart;
    selectionRect = null;
    btnApplyCrop.disabled = true;
  }

  function onCropMove(e) {
    if (!isCropMode || !isDrawingCrop) return;
    e.preventDefault();
    cropCurrent = getImageCoordinates(e);

    const x = Math.min(cropStart.x, cropCurrent.x);
    const y = Math.min(cropStart.y, cropCurrent.y);
    const width = Math.abs(cropCurrent.x - cropStart.x);
    const height = Math.abs(cropCurrent.y - cropStart.y);

    selectionRect = { x, y, width, height };

    if (width >= 15 && height >= 15) {
      btnApplyCrop.disabled = false;
    } else {
      btnApplyCrop.disabled = true;
    }

    renderCanvas();
  }

  function onCropEnd(e) {
    if (!isCropMode || !isDrawingCrop) return;
    isDrawingCrop = false;
    if (selectionRect && (selectionRect.width < 15 || selectionRect.height < 15)) {
      selectionRect = null;
      btnApplyCrop.disabled = true;
      renderCanvas();
    }
  }

  canvas.addEventListener("mousedown", onCropStart);
  window.addEventListener("mousemove", onCropMove);
  window.addEventListener("mouseup", onCropEnd);

  canvas.addEventListener("touchstart", onCropStart, { passive: false });
  window.addEventListener("touchmove", onCropMove, { passive: false });
  window.addEventListener("touchend", onCropEnd);

  // 7. API Call to /api/scan
  async function processScan(fileOrBlob) {
    scanOverlay.classList.remove("hidden");
    barcodeCount.innerText = "...";
    scanTime.innerText = "Scanning...";

    const formData = new FormData();
    formData.append("file", fileOrBlob, "scan.jpg");

    const aggressive = chkAggressive.checked;

    try {
      const res = await fetch(`/api/scan?aggressive=${aggressive}`, {
        method: "POST",
        body: formData
      });

      const data = await res.json();
      scanOverlay.classList.add("hidden");

      if (!res.ok || !data.success) {
        showAlert(data.error || "Gagal memproses gambar.", "error");
        barcodeCount.innerText = "0";
        scanTime.innerText = "Error";
        renderResults([]);
        return;
      }

      currentBarcodes = data.barcodes || [];
      barcodeCount.innerText = currentBarcodes.length;
      scanTime.innerText = `${data.time_ms} ms`;

      renderResults(currentBarcodes);
      renderCanvas();

      if (currentBarcodes.length === 0) {
        showToast("Tidak ada barcode yang terdeteksi.");
      } else {
        showToast(`Berhasil membaca ${currentBarcodes.length} barcode!`);
      }
    } catch (err) {
      scanOverlay.classList.add("hidden");
      showAlert("Koneksi ke backend gagal: " + err.message, "error");
      barcodeCount.innerText = "0";
      scanTime.innerText = "Error";
    }
  }

  // 8. Canvas Rendering
  function renderCanvas() {
    if (!activeImage) return;

    canvas.width = activeImage.naturalWidth || activeImage.width;
    canvas.height = activeImage.naturalHeight || activeImage.height;

    // Draw active image
    ctx.drawImage(activeImage, 0, 0);

    // If in Crop Mode, render crop overlay & selection box
    if (isCropMode) {
      if (selectionRect && selectionRect.width > 0 && selectionRect.height > 0) {
        // Darken outside selection
        ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Redraw the selected crisp part of the image
        ctx.drawImage(
          activeImage,
          selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height,
          selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height
        );

        // Stroke selection box with neon cyan outline
        const lineWidth = Math.max(2, Math.round(canvas.width / 500));
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = "#38bdf8";
        ctx.strokeRect(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);

        // Dashed inner guide
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 6]);
        ctx.strokeRect(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);
        ctx.setLineDash([]);

        // Draw corner handles
        const handleSize = Math.max(8, Math.round(canvas.width / 120));
        ctx.fillStyle = "#38bdf8";
        const corners = [
          [selectionRect.x, selectionRect.y],
          [selectionRect.x + selectionRect.width, selectionRect.y],
          [selectionRect.x + selectionRect.width, selectionRect.y + selectionRect.height],
          [selectionRect.x, selectionRect.y + selectionRect.height]
        ];
        corners.forEach(([cx, cy]) => {
          ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
        });

        // Dimensions badge
        const badgeText = `${Math.round(selectionRect.width)} × ${Math.round(selectionRect.height)} px`;
        const fontSize = Math.max(12, Math.round(canvas.width / 80));
        ctx.font = `600 ${fontSize}px Inter, sans-serif`;
        const textMetrics = ctx.measureText(badgeText);
        const badgeW = textMetrics.width + 16;
        const badgeH = fontSize + 10;
        const badgeX = selectionRect.x + (selectionRect.width - badgeW) / 2;
        const badgeY = Math.max(10, selectionRect.y - badgeH - 6);

        ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
        ctx.beginPath();
        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
        ctx.fill();
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = "#38bdf8";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2);
      }
      return;
    }

    // If NOT in crop mode, render detected barcodes & polygons
    currentBarcodes.forEach((b, idx) => {
      const isHovered = (idx === hoveredBarcodeIndex);
      const strokeColor = isHovered ? "#38bdf8" : "#10b981";
      const fillColor = isHovered ? "rgba(56, 189, 248, 0.25)" : "rgba(16, 185, 129, 0.18)";

      if (b.polygon && b.polygon.length >= 4) {
        ctx.beginPath();
        ctx.moveTo(b.polygon[0].x, b.polygon[0].y);
        for (let i = 1; i < b.polygon.length; i++) {
          ctx.lineTo(b.polygon[i].x, b.polygon[i].y);
        }
        ctx.closePath();

        ctx.fillStyle = fillColor;
        ctx.fill();

        ctx.lineWidth = Math.max(3, Math.round(canvas.width / 400));
        ctx.strokeStyle = strokeColor;
        ctx.stroke();

        // Draw pin badge with index number at top-left
        const p0 = b.polygon[0];
        const badgeRadius = Math.max(14, Math.round(canvas.width / 80));
        ctx.beginPath();
        ctx.arc(p0.x, p0.y, badgeRadius, 0, Math.PI * 2);
        ctx.fillStyle = strokeColor;
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${badgeRadius * 1.1}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText((idx + 1).toString(), p0.x, p0.y);
      }
    });
  }

  // 9. Results Panel Rendering
  function renderResults(barcodes) {
    resultsList.innerHTML = "";

    if (!barcodes || barcodes.length === 0) {
      const emptyCard = document.createElement("div");
      emptyCard.className = "empty-state";
      emptyCard.innerHTML = `
        <div class="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <h4>Barcode Belum Terdeteksi</h4>
        <div class="troubleshoot-box">
          <p class="troubleshoot-title">💡 Tips Membaca Barcode Modem:</p>
          <ul class="troubleshoot-list">
            <li><strong>Fokus Foto (Lens Blur):</strong> Garis barcode pada foto terlihat agak blur/menyatu. Usahakan foto diambil dengan fokus tajam agar garis tipis hitam terpisah jelas dari garis putih.</li>
            <li><strong>Zona Margin (Quiet Zone):</strong> Barcode wajib memiliki margin putih di sisi kiri & kanan. Saat melakukan <em>Crop</em>, sisakan sedikit ruang di luar garis hitam terluar.</li>
            <li><strong>Pantulan Cahaya (Glare):</strong> Jangan gunakan flash langsung jika stiker modem berbahan glossy.</li>
          </ul>
        </div>
      `;
      resultsList.appendChild(emptyCard);
      return;
    }

    const isHuaweiMode = chkFormatHuawei && chkFormatHuawei.checked;

    barcodes.forEach((item, index) => {
      const card = document.createElement("div");
      card.className = "barcode-card";
      card.dataset.index = index;

      const gponSn = item.gpon_sn || parseGponSn(item.text);

      let primaryText = item.text;
      let secondaryRowHtml = "";

      if (gponSn) {
        if (isHuaweiMode) {
          primaryText = gponSn;
          secondaryRowHtml = `
            <div class="gpon-secondary-row" title="Format Asli Hex 16-Digit">
              <span class="barcode-text" style="color: var(--text-secondary); font-size: 0.8rem;">
                <span class="gpon-tag" style="background: rgba(59,130,246,0.15); color: #60a5fa; border-color: rgba(59,130,246,0.3);">HEX</span>
                ${escapeHtml(item.text)}
              </span>
              <button class="btn-copy" title="Salin Raw Hex (16 Digit)" data-text="${escapeHtml(item.text)}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </div>
          `;
        } else {
          primaryText = item.text;
          secondaryRowHtml = `
            <div class="gpon-secondary-row" title="Format Huawei GPON SN">
              <span class="barcode-text">
                <span class="gpon-tag">HWTC / GPON</span>
                ${escapeHtml(gponSn)}
              </span>
              <button class="btn-copy" title="Salin Format Huawei (HWTC...)" data-text="${escapeHtml(gponSn)}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </div>
          `;
        }
      }

      card.innerHTML = `
        <div class="card-top">
          <span class="format-badge">#${index + 1} ${escapeHtml(item.format)}</span>
          <span class="stage-badge">${escapeHtml(item.stage || '')}</span>
        </div>
        <div class="barcode-value-wrap">
          <span class="barcode-text">${escapeHtml(primaryText)}</span>
          <button class="btn-copy" title="Salin ke clipboard" data-text="${escapeHtml(primaryText)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </div>
        ${secondaryRowHtml}
      `;

      // Highlight on hover
      card.addEventListener("mouseenter", () => {
        if (!isCropMode) {
          hoveredBarcodeIndex = index;
          renderCanvas();
        }
      });
      card.addEventListener("mouseleave", () => {
        if (!isCropMode) {
          hoveredBarcodeIndex = -1;
          renderCanvas();
        }
      });

      // Copy actions for all copy buttons in card
      const copyButtons = card.querySelectorAll(".btn-copy");
      copyButtons.forEach((btnCopy) => {
        btnCopy.addEventListener("click", (e) => {
          e.stopPropagation();
          const textToCopy = btnCopy.dataset.text;
          navigator.clipboard.writeText(textToCopy).then(() => {
            btnCopy.classList.add("copied");
            const originalIcon = btnCopy.innerHTML;
            btnCopy.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
            showToast(`Tersalin: ${textToCopy}`);
            setTimeout(() => {
              btnCopy.classList.remove("copied");
              btnCopy.innerHTML = originalIcon;
            }, 1800);
          });
        });
      });

      resultsList.appendChild(card);
    });
  }

  // Utilities
  function showAlert(message, type = "error") {
    alertBox.innerHTML = message;
    alertBox.classList.remove("hidden");
  }

  function hideAlert() {
    alertBox.classList.add("hidden");
    alertBox.innerHTML = "";
  }

  function showToast(message) {
    const toastContainer = document.getElementById("toastContainer");
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3200);
  }

  function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[m]));
  }
});
