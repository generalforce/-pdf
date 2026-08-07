
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
const pdfjsVersion = pdfjsLib.version || '4.10.38';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.min.mjs`;

type ProgressCallback = (progress: number) => void;

// --- Text Layout Engine ---

interface LayoutResult {
  pages: string[][]; // Array of pages, each page is array of lines
}

function layoutTextToPages(text: string, maxWidth: number, maxHeight: number, ctx: CanvasRenderingContext2D, lineHeight: number): LayoutResult {
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];
  
  // 1. Word Wrapping
  for (const para of paragraphs) {
    if (para.trim() === '') {
        lines.push(''); 
        continue;
    }
    
    const words = para.split(' ');
    let currentLine = '';
    
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const testLine = currentLine + (currentLine ? ' ' : '') + word;
        const metrics = ctx.measureText(testLine);
        
        if (metrics.width > maxWidth && i > 0) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    if (currentLine) lines.push(currentLine);
  }

  // 2. Pagination
  // Ensure we don't split right after a single line of a paragraph if possible (basic orphan check could be added here, but keeping simple for now)
  const linesPerPage = Math.floor(maxHeight / lineHeight);
  const pageCount = Math.ceil(lines.length / linesPerPage);
  const pages: string[][] = [];

  for (let p = 0; p < pageCount; p++) {
      const start = p * linesPerPage;
      const end = Math.min(start + linesPerPage, lines.length);
      const pageLines = lines.slice(start, end);
      if (pageLines.length > 0) {
          pages.push(pageLines);
      }
  }

  return { pages };
}

// --- Text To PDF Converter ---

async function textToPDF(file: File, onProgress?: ProgressCallback): Promise<PDFDocument> {
  const text = await file.text();
  if (onProgress) onProgress(10);

  const pdfDoc = await PDFDocument.create();
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return pdfDoc;

  // Configuration
  const scale = 2; // High res
  const a4w = 595.28;
  const a4h = 841.89;
  const width = a4w * scale;
  const height = a4h * scale;
  const fontSize = 14 * scale; 
  const lineHeight = 26 * scale; // Slightly more breathing room
  const margin = 50 * scale;
  const maxWidth = width - (margin * 2);
  const contentHeight = height - (margin * 2);
  
  canvas.width = width;
  canvas.height = height;
  
  // Font Setup
  ctx.font = `${fontSize}px Vazirmatn, Tahoma, Arial, sans-serif`;
  ctx.fillStyle = '#1e293b'; 
  ctx.textBaseline = 'top';
  
  // RTL Detection (Basic)
  const isRTL = /[\u0600-\u06FF]/.test(text.substring(0, 500));
  ctx.direction = isRTL ? 'rtl' : 'ltr';
  ctx.textAlign = isRTL ? 'right' : 'left';
  const x = isRTL ? width - margin : margin;

  // Perform Layout
  const layout = layoutTextToPages(text, maxWidth, contentHeight, ctx, lineHeight);
  if (onProgress) onProgress(30);

  const totalPages = layout.pages.length;
  
  for (let p = 0; p < totalPages; p++) {
      // Clear canvas
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0,0, width, height);
      ctx.fillStyle = '#1e293b';
      
      const lines = layout.pages[p];
      for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const y = margin + (i * lineHeight);
          ctx.fillText(line, x, y);
      }
      
      const imgData = canvas.toDataURL('image/jpeg', 0.75); // Slightly compressed for speed
      const img = await pdfDoc.embedJpg(imgData);
      const page = pdfDoc.addPage([a4w, a4h]);
      page.drawImage(img, { x: 0, y: 0, width: a4w, height: a4h });
      
      // Progress from 30% to 100%
      if (onProgress) onProgress(30 + Math.round(((p + 1) / totalPages) * 70));
  }
  
  return pdfDoc;
}

// --- Helper for Text Splitting (Layout only) ---

async function splitTextFileToContent(file: File, onProgress?: ProgressCallback): Promise<string[]> {
    const text = await file.text();
    if (onProgress) onProgress(20);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return [text];

    // Same config as PDF to match pages
    const scale = 2;
    const width = 595.28 * scale;
    const height = 841.89 * scale;
    const fontSize = 14 * scale; 
    const lineHeight = 26 * scale;
    const margin = 50 * scale;
    const maxWidth = width - (margin * 2);
    const contentHeight = height - (margin * 2);

    ctx.font = `${fontSize}px Vazirmatn, Tahoma, Arial, sans-serif`;
    
    const layout = layoutTextToPages(text, maxWidth, contentHeight, ctx, lineHeight);
    if (onProgress) onProgress(100);

    return layout.pages.map(lines => lines.join('\n'));
}

async function getPDFDocument(file: File, onProgress?: ProgressCallback): Promise<PDFDocument> {
  if (file.type === 'text/plain') {
    return await textToPDF(file, onProgress);
  }
  const arrayBuffer = await file.arrayBuffer();
  if (onProgress) onProgress(50);
  return await PDFDocument.load(arrayBuffer);
}

// Helper to extract text from a single file (PDF or TXT)
async function extractTextFromFile(file: File): Promise<string> {
  if (file.type === 'text/plain') {
    return await file.text();
  }
  
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tokenizedText = await page.getTextContent();
    const pageText = tokenizedText.items.map((token: any) => token.str).join(' ');
    fullText += pageText + '\n\n';
  }
  return fullText;
}

export async function mergePDFs(files: File[], onProgress?: ProgressCallback): Promise<Uint8Array> {
  const mergedPdf = await PDFDocument.create();
  const total = files.length;

  for (let i = 0; i < total; i++) {
    const file = files[i];
    // Pass a sub-progress callback
    const fileProgress = (p: number) => {
        if (onProgress) onProgress(Math.round(((i + (p / 100)) / total) * 100));
    };
    
    const pdf = await getPDFDocument(file, file.type === 'text/plain' ? fileProgress : undefined);
    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
    
    // Fallback progress update
    if (onProgress) onProgress(Math.round(((i + 1) / total) * 100));
  }

  const result = await mergedPdf.save();
  if (onProgress) onProgress(100);
  return result;
}

export async function splitPDF(file: File, onProgress?: ProgressCallback): Promise<{ name: string; bytes: Uint8Array }[]> {
  // If text, this converts to PDF first with progress
  const pdf = await getPDFDocument(file, (p) => {
      if (onProgress) onProgress(Math.round(p * 0.5)); // First 50% for loading/conversion
  });
  
  const pageCount = pdf.getPageCount();
  const splitFiles: { name: string; bytes: Uint8Array }[] = [];

  for (let i = 0; i < pageCount; i++) {
    const newPdf = await PDFDocument.create();
    const [page] = await newPdf.copyPages(pdf, [i]);
    newPdf.addPage(page);
    const bytes = await newPdf.save();
    const fileName = `${file.name.replace(/\.(pdf|txt)$/i, '')}_page_${i + 1}.pdf`;
    splitFiles.push({ name: fileName, bytes });
    
    if (onProgress) onProgress(50 + Math.round(((i + 1) / pageCount) * 50));
  }

  return splitFiles;
}

export async function splitIntoParts(file: File, partCount: number, onProgress?: ProgressCallback): Promise<{ name: string; bytes: Uint8Array }[]> {
  const pdf = await getPDFDocument(file, (p) => { if(onProgress) onProgress(p * 0.5); });
  const totalPages = pdf.getPageCount();
  const results: { name: string; bytes: Uint8Array }[] = [];

  const pagesPerPart = Math.ceil(totalPages / partCount);

  for (let i = 0; i < partCount; i++) {
    const startIdx = i * pagesPerPart;
    const endIdx = Math.min((i + 1) * pagesPerPart, totalPages);
    
    if (startIdx >= totalPages) break;

    const newPdf = await PDFDocument.create();
    const indices = Array.from({ length: endIdx - startIdx }, (_, k) => startIdx + k);
    const copiedPages = await newPdf.copyPages(pdf, indices);
    copiedPages.forEach(page => newPdf.addPage(page));
    
    const bytes = await newPdf.save();
    const fileName = `${file.name.replace(/\.(pdf|txt)$/i, '')}_part_${i + 1}.pdf`;
    results.push({ name: fileName, bytes });
    
    if (onProgress) onProgress(50 + Math.round(((i + 1) / partCount) * 50));
  }

  return results;
}

export async function splitBySplitPoints(file: File, splitPoints: number[], onProgress?: ProgressCallback): Promise<{ name: string; bytes: Uint8Array }[]> {
  const pdf = await getPDFDocument(file, (p) => { if(onProgress) onProgress(p * 0.5); });
  const totalPages = pdf.getPageCount();
  const results: { name: string; bytes: Uint8Array }[] = [];

  const sortedPoints = [...new Set(splitPoints)]
    .filter(p => p > 0 && p < totalPages)
    .sort((a, b) => a - b);

  let currentStart = 1;
  const totalParts = sortedPoints.length + 1;

  for (let i = 0; i < sortedPoints.length; i++) {
    const point = sortedPoints[i];
    const newPdf = await PDFDocument.create();
    const indices = [];
    for (let k = currentStart - 1; k < point; k++) {
        indices.push(k);
    }
    const copiedPages = await newPdf.copyPages(pdf, indices);
    copiedPages.forEach(page => newPdf.addPage(page));

    const bytes = await newPdf.save();
    results.push({ name: `${file.name.replace(/\.(pdf|txt)$/i, '')}_part_${results.length + 1}.pdf`, bytes });

    currentStart = point + 1;
    if (onProgress) onProgress(50 + Math.round(((i + 1) / totalParts) * 50));
  }

  if (currentStart <= totalPages) {
    const newPdf = await PDFDocument.create();
    const indices = [];
    for (let k = currentStart - 1; k < totalPages; k++) {
        indices.push(k);
    }
    const copiedPages = await newPdf.copyPages(pdf, indices);
    copiedPages.forEach(page => newPdf.addPage(page));

    const bytes = await newPdf.save();
    results.push({ name: `${file.name.replace(/\.(pdf|txt)$/i, '')}_part_${results.length + 1}.pdf`, bytes });
  }
  
  if (onProgress) onProgress(100);

  return results;
}

export async function extractRange(file: File, start: number, end: number, onProgress?: ProgressCallback): Promise<{ name: string; bytes: Uint8Array }> {
  if (onProgress) onProgress(5);
  const pdf = await getPDFDocument(file, (p) => { if(onProgress) onProgress(p * 0.4); });
  const totalPages = pdf.getPageCount();
  
  const newPdf = await PDFDocument.create();
  
  const startIdx = Math.max(1, Math.min(start, totalPages));
  const endIdx = Math.max(startIdx, Math.min(end, totalPages));
  
  if (onProgress) onProgress(50);

  const indices = [];
  for (let i = startIdx - 1; i < endIdx; i++) {
    indices.push(i);
  }
  
  const copiedPages = await newPdf.copyPages(pdf, indices);
  copiedPages.forEach(page => newPdf.addPage(page));
  
  if (onProgress) onProgress(80);

  const bytes = await newPdf.save();
  const fileName = `${file.name.replace(/\.(pdf|txt)$/i, '')}_pages_${startIdx}_to_${endIdx}.pdf`;
  
  if (onProgress) onProgress(100);
  return { name: fileName, bytes };
}

export async function getPageCount(file: File): Promise<number> {
  // Lazy load: For TXT, assume 1 page initially to skip heavy rendering
  if (file.type === 'text/plain') return 1;
  const pdf = await getPDFDocument(file);
  return pdf.getPageCount();
}

export async function imagesToPDF(files: File[], onProgress?: ProgressCallback): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const total = files.length;

  for (let i = 0; i < total; i++) {
    const file = files[i];
    const arrayBuffer = await file.arrayBuffer();
    let image;
    if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
      image = await pdfDoc.embedJpg(arrayBuffer);
    } else if (file.type === 'image/png') {
      image = await pdfDoc.embedPng(arrayBuffer);
    } else {
      continue;
    }
    const page = pdfDoc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    
    if (onProgress) onProgress(Math.round(((i + 1) / total) * 90));
  }
  const result = await pdfDoc.save();
  if (onProgress) onProgress(100);
  return result;
}

export async function pdfToImages(file: File, onProgress?: ProgressCallback): Promise<{ name: string; dataUrl: string }[]> {
  let data: ArrayBuffer;
  
  if (file.type === 'text/plain') {
    // If text, convert to PDF first
    const pdfDoc = await textToPDF(file, (p) => { if(onProgress) onProgress(p * 0.4); });
    const bytes = await pdfDoc.save();
    data = bytes.buffer;
  } else {
    data = await file.arrayBuffer();
  }

  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  const results = [];
  const total = pdf.numPages;

  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    if (context) {
      await page.render({ canvasContext: context, viewport }).promise;
      results.push({
        name: `${file.name.replace(/\.(pdf|txt)$/i, '')}_page_${i}.png`,
        dataUrl: canvas.toDataURL('image/png')
      });
    }
    // Map progress 40-100%
    if (onProgress) onProgress(40 + Math.round((i / total) * 60));
  }
  return results;
}

export async function compressImage(dataUrl: string, quality: number, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas context null')); return; }
      
      if (mimeType === 'image/jpeg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL(mimeType, quality));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// New Text Extraction Functions

export async function extractTextFromFiles(files: File[], onProgress?: ProgressCallback): Promise<string> {
  let finalResult = '';
  const total = files.length;
  
  for (let i = 0; i < total; i++) {
    const text = await extractTextFromFile(files[i]);
    if (total > 1) {
        finalResult += `--- Start of ${files[i].name} ---\n\n`;
    }
    finalResult += text + '\n\n';
    if (total > 1) {
        finalResult += `--- End of ${files[i].name} ---\n\n`;
    }
    if (onProgress) onProgress(Math.round(((i + 1) / total) * 100));
  }
  
  return finalResult;
}

export async function extractTextPages(file: File, onProgress?: ProgressCallback): Promise<string[]> {
  const results: string[] = [];
  
  if (file.type === 'text/plain') {
      // Use the layout engine to split text into "pages" visually matching the PDF output
      // This ensures "Split" mode creates meaningful text chunks rather than just 1 big file
      const pages = await splitTextFileToContent(file, onProgress);
      return pages;
  }

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const total = pdf.numPages;

  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const tokenizedText = await page.getTextContent();
    const pageText = tokenizedText.items.map((token: any) => token.str).join(' ');
    results.push(pageText);
    if (onProgress) onProgress(Math.round((i / total) * 100));
  }
  
  return results;
}
