let opencvPromise: Promise<void> | null = null;

function loadOpenCv(): Promise<void> {
  if (opencvPromise) return opencvPromise;

  const promise = new Promise<void>((resolve, reject) => {
    const fail = (err: Error) => {
      if (opencvPromise === promise) opencvPromise = null;
      reject(err);
    };

    const timeout = setTimeout(() => {
      fail(new Error('[ocr] OpenCV load timeout'));
    }, 15000);

    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.10.0/opencv.js';
    script.async = true;

    script.onload = () => {
      const win = window as unknown as { cv?: { onRuntimeInitialized?: () => void; Mat?: unknown } };
      if (win.cv && win.cv.Mat) {
        clearTimeout(timeout);
        resolve();
      } else if (win.cv) {
        win.cv.onRuntimeInitialized = () => {
          clearTimeout(timeout);
          resolve();
        };
      } else {
        clearTimeout(timeout);
        fail(new Error('[ocr] cv not found after script load'));
      }
    };

    script.onerror = () => {
      clearTimeout(timeout);
      fail(new Error('[ocr] OpenCV script load error'));
    };

    document.head.appendChild(script);
  });

  opencvPromise = promise;
  return promise;
}

async function compressImage(file: File): Promise<File> {
  const { default: imageCompression } = await import('browser-image-compression');
  return imageCompression(file, {
    maxWidthOrHeight: 1500,
    maxSizeMB: 1.5,
    useWebWorker: true,
    initialQuality: 0.85,
  });
}

let pdfjsWorkerSet = false;

async function renderPdfFirstPage(file: File): Promise<HTMLCanvasElement> {
  const pdfjs = await import('pdfjs-dist');

  if (!pdfjsWorkerSet) {
    pdfjsWorkerSet = true;
    pdfjs.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.6.205/pdf.worker.min.mjs';
  }

  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 2 });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;

  return canvas;
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('[ocr] image load error'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function deskew(
  source: HTMLImageElement | HTMLCanvasElement,
): Promise<HTMLImageElement | HTMLCanvasElement> {
  try {
    await loadOpenCv();
    const jscanifyMod = await import('jscanify/client');
    const JscanifyClass = jscanifyMod.default ?? jscanifyMod;
    const scanner = new (JscanifyClass as unknown as new () => InstanceType<typeof JscanifyClass>)();
    return scanner.extractPaper(source, 1500, 2000);
  } catch (err) {
    console.warn('[ocr] deskew skipped:', err);
    return source;
  }
}

export function cleanOcrText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .toLowerCase()
    .split('\n')
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter((l) => l.length >= 3)
    .join('\n')
    .slice(0, 8000);
}

export async function runOcr(file: File): Promise<string> {
  const source =
    file.type === 'application/pdf'
      ? await deskew(await renderPdfFirstPage(file))
      : await deskew(await loadImageElement(await compressImage(file)));

  const Tesseract = (await import('tesseract.js')).default;
  const { data } = await Tesseract.recognize(source, 'eng', { logger: () => {} });
  return cleanOcrText(data.text);
}
