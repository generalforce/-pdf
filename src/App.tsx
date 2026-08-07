import React, { useState, useRef, useMemo, useEffect } from 'react';
import JSZip from 'jszip';
import { PDFFile, AppStatus, AppMode } from './types';
import { mergePDFs, splitPDF, extractRange, getPageCount, splitIntoParts, imagesToPDF, pdfToImages, splitBySplitPoints, compressImage, extractTextFromFiles, extractTextPages } from './services/pdfService';
import { FileIcon, XIcon, DownloadIcon, PlusIcon } from './components/Icons';

type SplitSubMode = 'RANGE' | 'PARTS' | 'CUSTOM' | 'ALL';
type TextToolOp = 'MERGE' | 'SPLIT';

interface ZipOption {
  label: string;
  ext: string;
  mime: string;
  quality: number;
  size: number;
}

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.MERGE);
  const [textToolOp, setTextToolOp] = useState<TextToolOp>('MERGE');
  const [splitSubMode, setSplitSubMode] = useState<SplitSubMode>('RANGE');
  const [files, setFiles] = useState<PDFFile[]>([]);
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [progress, setProgress] = useState<number>(0);
  const [mergedBlob, setMergedBlob] = useState<Blob | null>(null);
  const [mergedTxtBlob, setMergedTxtBlob] = useState<Blob | null>(null); // For Text Tools
  const [splitResults, setSplitResults] = useState<{ name: string; blob: Blob }[]>([]);
  const [imageResults, setImageResults] = useState<{ name: string; dataUrl: string }[]>([]);
  
  // For Text Tools Split Results (Strings)
  const [textSplitResults, setTextSplitResults] = useState<{ name: string; content: string }[]>([]);

  const [isDragging, setIsDragging] = useState(false);
  
  // New state for Zip Quality Modal
  const [showZipModal, setShowZipModal] = useState(false);
  const [calculatingZip, setCalculatingZip] = useState(false);
  const [zipOptions, setZipOptions] = useState<ZipOption[]>([]);

  // New state for Text Tools Choice Modal
  const [showTextChoiceModal, setShowTextChoiceModal] = useState(false);

  const [pageRange, setPageRange] = useState({ start: 1, end: 1 });
  const [partsToSplit, setPartsToSplit] = useState(2);
  const [customSplitInput, setCustomSplitInput] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalPages = useMemo(() => files.reduce((sum, f) => sum + (f.pageCount || 0), 0), [files]);
  const totalSize = useMemo(() => files.reduce((sum, f) => sum + f.size, 0), [files]);

  useEffect(() => {
    if (files.length > 0) {
        if (mode === AppMode.SPLIT) {
             if (files[0].pageCount) setPageRange({ start: 1, end: files[0].pageCount });
        } else if (mode === AppMode.TEXT_TOOLS) {
             const maxPage = Math.max(...files.map(f => f.pageCount || 0));
             setPageRange({ start: 1, end: maxPage || 1 });
        }
    }
  }, [files, mode]);
  
  useEffect(() => {
     if (mode === AppMode.TEXT_TOOLS) {
         if (files.length === 0) setTextToolOp('MERGE');
     }
  }, [files.length, mode]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let incomingFiles: File[] = [];
    if ('files' in e.target && e.target.files) {
      incomingFiles = Array.from(e.target.files);
    } else if ('dataTransfer' in e && e.dataTransfer.files) {
      incomingFiles = Array.from(e.dataTransfer.files);
    }

    let validFiles: File[] = [];
    if (mode === AppMode.IMG_TO_PDF) {
      validFiles = incomingFiles.filter(f => f.type.startsWith('image/'));
    } else if (mode === AppMode.TEXT_TOOLS) {
      validFiles = incomingFiles.filter(f => f.type === 'text/plain');
    } else {
      validFiles = incomingFiles.filter(f => f.type === 'application/pdf');
    }

    if (validFiles.length === 0) return;

    const isSingleFileMode = mode === AppMode.SPLIT || mode === AppMode.PDF_TO_IMG;
    const processedFiles = isSingleFileMode ? [validFiles[0]] : validFiles;
    
    const newFiles: PDFFile[] = [];
    for (const file of processedFiles) {
      const id = Math.random().toString(36).substr(2, 9);
      let pageCount = 0;
      if (file.type === 'application/pdf' || file.type === 'text/plain') {
        try { pageCount = await getPageCount(file); } catch (err) { console.error(err); }
      } else if (file.type.startsWith('image/')) {
        pageCount = 1;
      }

      newFiles.push({
        id,
        file,
        name: file.name,
        size: file.size,
        pageCount
      });
    }
    
    if (isSingleFileMode) {
      setFiles(newFiles);
      setSplitResults([]);
      setImageResults([]);
      setTextSplitResults([]);
    } else {
      setFiles(prev => [...prev, ...newFiles]);
    }
    
    if (fileInputRef.current) fileInputRef.current.value = '';
    setMergedBlob(null);
    setMergedTxtBlob(null);
    setStatus(AppStatus.IDLE);
    setProgress(0);
  };

  const handleAction = async () => {
    setStatus(AppStatus.PROCESSING);
    setProgress(0);
    const onProgress = (p: number) => setProgress(p);

    try {
      if (mode === AppMode.MERGE) {
        if (files.length < 2) return;
        const mergedBytes = await mergePDFs(files.map(f => f.file), onProgress);
        setMergedBlob(new Blob([mergedBytes], { type: 'application/pdf' }));
        setStatus(AppStatus.SUCCESS);
      } else if (mode === AppMode.SPLIT) {
        if (files.length !== 1) return;
        let results: { name: string; blob: Blob }[] = [];
        if (splitSubMode === 'RANGE') {
          const result = await extractRange(files[0].file, pageRange.start, pageRange.end, onProgress);
          results = [{ name: result.name, blob: new Blob([result.bytes], { type: 'application/pdf' }) }];
        } else if (splitSubMode === 'PARTS') {
          const resultParts = await splitIntoParts(files[0].file, partsToSplit, onProgress);
          results = resultParts.map(r => ({ name: r.name, blob: new Blob([r.bytes], { type: 'application/pdf' }) }));
        } else if (splitSubMode === 'CUSTOM') {
          const points = customSplitInput.split(/[\s,]+/).map(s => parseInt(s.trim())).filter(n => !isNaN(n));
          const resultParts = await splitBySplitPoints(files[0].file, points, onProgress);
          results = resultParts.map(r => ({ name: r.name, blob: new Blob([r.bytes], { type: 'application/pdf' }) }));
        } else if (splitSubMode === 'ALL') {
          const resultPages = await splitPDF(files[0].file, onProgress);
          results = resultPages.map(r => ({ name: r.name, blob: new Blob([r.bytes], { type: 'application/pdf' }) }));
        }
        setSplitResults(results);
        setStatus(AppStatus.SUCCESS);
      } else if (mode === AppMode.IMG_TO_PDF) {
        if (files.length < 1) return;
        const pdfBytes = await imagesToPDF(files.map(f => f.file), onProgress);
        setMergedBlob(new Blob([pdfBytes], { type: 'application/pdf' }));
        setStatus(AppStatus.SUCCESS);
      } else if (mode === AppMode.PDF_TO_IMG) {
        if (files.length !== 1) return;
        const results = await pdfToImages(files[0].file, onProgress);
        setImageResults(results);
        setStatus(AppStatus.SUCCESS);
      } else if (mode === AppMode.TEXT_TOOLS) {
        setShowTextChoiceModal(true);
      }
    } catch (error) {
      console.error(error);
      setStatus(AppStatus.ERROR);
    }
  };

  const handleTextToolChoice = async (choice: 'PDF' | 'TXT') => {
    setShowTextChoiceModal(false);
    setStatus(AppStatus.PROCESSING);
    setProgress(0);
    
    setMergedBlob(null);
    setMergedTxtBlob(null);
    setSplitResults([]);
    setTextSplitResults([]);
    
    try {
        if (textToolOp === 'MERGE') {
            if (choice === 'PDF') {
                 const mergedBytes = await mergePDFs(files.map(f => f.file), setProgress);
                 setMergedBlob(new Blob([mergedBytes], { type: 'application/pdf' }));
            } else {
                 const mergedText = await extractTextFromFiles(files.map(f => f.file), setProgress);
                 setMergedTxtBlob(new Blob([mergedText], { type: 'text/plain;charset=utf-8' }));
            }
        } else {
            const allPdfResults: { name: string; blob: Blob }[] = [];
            const allTxtResults: { name: string; content: string }[] = [];
            
            const total = files.length;
            
            for (let i = 0; i < total; i++) {
                const file = files[i];
                const baseName = file.name.replace(/\.(pdf|txt)$/i, '');
                
                const fileProgress = (p: number) => {
                    setProgress(Math.round(((i + (p / 100)) / total) * 100));
                };

                if (choice === 'PDF') {
                    let pdfResults: { name: string; bytes: Uint8Array }[] = [];
                    
                    if (splitSubMode === 'RANGE') {
                         const res = await extractRange(file.file, pageRange.start, pageRange.end, fileProgress);
                         pdfResults = [res];
                    } else if (splitSubMode === 'PARTS') {
                         pdfResults = await splitIntoParts(file.file, partsToSplit, fileProgress);
                    } else if (splitSubMode === 'CUSTOM') {
                         const points = customSplitInput.split(/[\s,]+/).map(s => parseInt(s.trim())).filter(n => !isNaN(n));
                         pdfResults = await splitBySplitPoints(file.file, points, fileProgress);
                    } else {
                         pdfResults = await splitPDF(file.file, fileProgress);
                    }
                    pdfResults.forEach(r => {
                        allPdfResults.push({ name: `${baseName}_${r.name}`, blob: new Blob([r.bytes], { type: 'application/pdf' }) });
                    });
                } else {
                    const allPages = await extractTextPages(file.file, fileProgress);
                    
                    if (splitSubMode === 'RANGE') {
                        const start = Math.max(1, Math.min(pageRange.start, allPages.length));
                        const end = Math.max(start, Math.min(pageRange.end, allPages.length));
                        allTxtResults.push({
                            name: `${baseName}_pages_${start}_to_${end}.txt`,
                            content: allPages.slice(start - 1, end).join('\n\n')
                        });
                    } else if (splitSubMode === 'PARTS') {
                         const pagesPerPart = Math.ceil(allPages.length / partsToSplit);
                         for (let j = 0; j < partsToSplit; j++) {
                            const startIdx = j * pagesPerPart;
                            const endIdx = Math.min((j + 1) * pagesPerPart, allPages.length);
                            if (startIdx >= allPages.length) break;
                            allTxtResults.push({
                                name: `${baseName}_part_${j + 1}.txt`,
                                content: allPages.slice(startIdx, endIdx).join('\n\n')
                            });
                         }
                    } else if (splitSubMode === 'CUSTOM') {
                        const points = customSplitInput.split(/[\s,]+/).map(s => parseInt(s.trim())).filter(n => !isNaN(n))
                            .filter(p => p > 0 && p < allPages.length)
                            .sort((a, b) => a - b);
                        const uniquePoints = [...new Set(points)];
                        let currentStart = 0;
                        
                        for(let j=0; j<uniquePoints.length; j++) {
                            const end = uniquePoints[j];
                            allTxtResults.push({
                                name: `${baseName}_part_${j+1}.txt`,
                                content: allPages.slice(currentStart, end).join('\n\n')
                            });
                            currentStart = end;
                        }
                        if (currentStart < allPages.length) {
                            allTxtResults.push({
                                 name: `${baseName}_part_${uniquePoints.length + 1}.txt`,
                                 content: allPages.slice(currentStart).join('\n\n')
                            });
                        }
                    } else {
                        allPages.forEach((content, idx) => {
                            allTxtResults.push({ 
                                name: `${baseName}_page_${idx + 1}.txt`, 
                                content 
                            });
                        });
                    }
                }
            }
            
            if (choice === 'PDF') {
                setSplitResults(allPdfResults);
            } else {
                setTextSplitResults(allTxtResults);
            }
        }
        setStatus(AppStatus.SUCCESS);
    } catch (error) {
        console.error(error);
        setStatus(AppStatus.ERROR);
    }
  };

  const downloadFile = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadTextContent = (content: string, name: string) => {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      downloadFile(blob, name);
  };

  const downloadDataUrl = (dataUrl: string, name: string) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const openZipModal = async () => {
    if (imageResults.length === 0) return;
    setCalculatingZip(true);
    const sample = imageResults[0].dataUrl; 
    const configs: { label: string; mime: string; quality: number; ext: string }[] = [
        { label: 'کیفیت اصلی (PNG)', mime: 'image/png', quality: 1, ext: 'png' },
        { label: 'بسیار عالی (JPEG 95%)', mime: 'image/jpeg', quality: 0.95, ext: 'jpg' },
        { label: 'کیفیت بالا (JPEG 80%)', mime: 'image/jpeg', quality: 0.8, ext: 'jpg' },
        { label: 'کیفیت متوسط (JPEG 60%)', mime: 'image/jpeg', quality: 0.6, ext: 'jpg' },
        { label: 'کم حجم (JPEG 40%)', mime: 'image/jpeg', quality: 0.4, ext: 'jpg' },
        { label: 'بسیار کم حجم (JPEG 20%)', mime: 'image/jpeg', quality: 0.2, ext: 'jpg' },
        { label: 'فوق‌العاده کم حجم (JPEG 10%)', mime: 'image/jpeg', quality: 0.1, ext: 'jpg' },
        { label: 'حداقل حجم (JPEG 5%)', mime: 'image/jpeg', quality: 0.05, ext: 'jpg' }
    ];
    const options: ZipOption[] = [];
    try {
      for (const conf of configs) {
          let convertedSize = 0;
          if (conf.mime === 'image/png') {
              convertedSize = sample.length;
          } else {
              const converted = await compressImage(sample, conf.quality, conf.mime);
              convertedSize = converted.length;
          }
          const byteLength = (convertedSize * 3) / 4; 
          options.push({ ...conf, size: byteLength * imageResults.length });
      }
      setZipOptions(options);
      setCalculatingZip(false);
      setShowZipModal(true);
    } catch (error) {
      console.error(error);
      setCalculatingZip(false);
    }
  };

  const performZipDownload = async (option: ZipOption) => {
    setShowZipModal(false);
    setStatus(AppStatus.PROCESSING);
    setProgress(0);
    try {
        const zip = new JSZip();
        const total = imageResults.length;
        for (let i = 0; i < total; i++) {
            const img = imageResults[i];
            let data = img.dataUrl;
            if (option.mime !== 'image/png') {
                 data = await compressImage(img.dataUrl, option.quality, option.mime);
            }
            const base64Data = data.split(',')[1];
            const fileName = img.name.replace(/\.[^/.]+$/, "") + "." + option.ext;
            zip.file(fileName, base64Data, { base64: true });
            setProgress(Math.round(((i + 1) / total) * 90));
        }
        const content = await zip.generateAsync({ type: 'blob' });
        setProgress(100);
        downloadFile(content, `images_bundle_${Date.now()}.zip`);
        setStatus(AppStatus.SUCCESS);
    } catch (e) {
        console.error(e);
        setStatus(AppStatus.ERROR);
    }
  };
  
  const downloadAllAsZip = async () => {
    if (splitResults.length === 0 && textSplitResults.length === 0) return;
    
    setStatus(AppStatus.PROCESSING);
    setProgress(0);
    
    try {
      const zip = new JSZip();
      
      // Add PDFs
      splitResults.forEach((res) => {
        zip.file(res.name, res.blob);
      });
      
      // Add TXTs
      textSplitResults.forEach((res) => {
        zip.file(res.name, res.content);
      });
      
      const content = await zip.generateAsync({ type: 'blob' }, (metadata: { percent: number }) => {
        setProgress(metadata.percent);
      });
      
      downloadFile(content, `split_files_${Date.now()}.zip`);
      setStatus(AppStatus.SUCCESS);
    } catch (error) {
      console.error(error);
      setStatus(AppStatus.ERROR);
    }
  };

  const switchMode = (newMode: AppMode) => {
    if (mode === newMode) return;
    setMode(newMode);
    // Reset op state when switching main modes
    if (newMode === AppMode.TEXT_TOOLS) setTextToolOp('MERGE');
    
    setFiles([]);
    setStatus(AppStatus.IDLE);
    setMergedBlob(null);
    setMergedTxtBlob(null);
    setSplitResults([]);
    setImageResults([]);
    setTextSplitResults([]);
    setProgress(0);
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
    setMergedBlob(null);
    setMergedTxtBlob(null);
    setSplitResults([]);
    setImageResults([]);
    setTextSplitResults([]);
    setStatus(AppStatus.IDLE);
    setProgress(0);
  };

  const moveFile = (index: number, direction: 'up' | 'down') => {
    const newFiles = [...files];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newFiles.length) return;
    const [moved] = newFiles.splice(index, 1);
    newFiles.splice(targetIndex, 0, moved);
    setFiles(newFiles);
  };

  const getAcceptTypes = () => {
    if (mode === AppMode.IMG_TO_PDF) return "image/png, image/jpeg, image/jpg";
    if (mode === AppMode.TEXT_TOOLS) return "text/plain";
    return "application/pdf";
  };

  const getActionText = () => {
    if (status === AppStatus.PROCESSING) return `در حال پردازش... (${progress}%)`;
    switch (mode) {
      case AppMode.MERGE: return 'تولید فایل نهایی';
      case AppMode.SPLIT: return 'اجرای عملیات جداسازی';
      case AppMode.IMG_TO_PDF: return 'تبدیل تصاویر به PDF';
      case AppMode.PDF_TO_IMG: return 'تبدیل PDF به تصویر';
      case AppMode.TEXT_TOOLS: return textToolOp === 'MERGE' ? 'ادغام فایل‌ها' : 'اجرای عملیات جداسازی';
      default: return 'پردازش';
    }
  };

  const getUploadText = () => {
    if ((mode === AppMode.SPLIT || mode === AppMode.PDF_TO_IMG) && files.length > 0) return 'تغییر فایل';
    if (mode === AppMode.IMG_TO_PDF) return 'افزودن تصویر';
    return 'افزودن فایل';
  };

  const resultCount = Math.max(splitResults.length, textSplitResults.length);

  const isActionDisabled = () => {
      if (status === AppStatus.PROCESSING) return true;
      if (mode === AppMode.MERGE) return files.length < 2;
      if (mode === AppMode.TEXT_TOOLS) {
          if (textToolOp === 'MERGE') return files.length < 2;
          return files.length < 1;
      }
      return files.length < 1;
  };

  return (
    <div className="min-h-screen text-slate-900 flex flex-col items-center">
      {/* Zip Modal */}
      {showZipModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowZipModal(false)}></div>
          <div className="relative bg-white rounded-[2rem] p-6 w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-300">
             <div className="flex justify-between items-center mb-6">
                <button onClick={() => setShowZipModal(false)} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400">
                  <XIcon className="w-5 h-5" />
                </button>
                <h3 className="text-xl font-black text-slate-800">انتخاب کیفیت دانلود</h3>
             </div>
             <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
               {zipOptions.map((opt, i) => (
                 <button key={i} onClick={() => performZipDownload(opt)} className="w-full flex items-center justify-between p-4 rounded-2xl border-2 border-slate-100 hover:border-indigo-500 hover:bg-indigo-50 transition-all group">
                    <span className="font-bold text-slate-500 text-xs font-inter group-hover:text-indigo-700 bg-slate-100 px-3 py-1 rounded-lg group-hover:bg-white/50">{formatSize(opt.size)}</span>
                    <span className="font-bold text-slate-700 group-hover:text-indigo-900">{opt.label}</span>
                 </button>
               ))}
             </div>
          </div>
        </div>
      )}

      {/* Text Tools Choice Modal */}
      {showTextChoiceModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowTextChoiceModal(false)}></div>
          <div className="relative bg-white rounded-[2rem] p-6 w-full max-w-sm shadow-2xl animate-in fade-in zoom-in-95 duration-300">
             <div className="flex justify-between items-center mb-6">
                <button onClick={() => setShowTextChoiceModal(false)} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400">
                  <XIcon className="w-5 h-5" />
                </button>
                <h3 className="text-xl font-black text-slate-800">نوع خروجی را انتخاب کنید</h3>
             </div>
             <div className="grid grid-cols-1 gap-3">
                 <button onClick={() => handleTextToolChoice('TXT')} className="w-full py-4 bg-blue-50 text-blue-600 rounded-2xl hover:bg-blue-500 hover:text-white transition-all font-bold flex items-center justify-center gap-3">
                    <FileIcon className="w-6 h-6" />
                    <span>خروجی متن (TXT)</span>
                 </button>
                 <button onClick={() => handleTextToolChoice('PDF')} className="w-full py-4 bg-rose-50 text-rose-600 rounded-2xl hover:bg-rose-500 hover:text-white transition-all font-bold flex items-center justify-center gap-3">
                    <FileIcon className="w-6 h-6" />
                    <span>خروجی سند (PDF)</span>
                 </button>
             </div>
          </div>
        </div>
      )}

      <nav className="w-full h-auto min-h-20 glass-panel sticky top-0 z-50 px-8 py-4 flex flex-col md:flex-row items-center justify-between border-b border-slate-200/50 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
            <FileIcon className="text-white w-6 h-6" />
          </div>
          <span className="text-xl font-extrabold tracking-tight text-slate-800">PDF<span className="text-indigo-600">Fusion</span></span>
        </div>

        <div className="flex flex-wrap justify-center p-1 bg-slate-100 rounded-2xl border border-slate-200/50 scale-90 md:scale-100">
          <button onClick={() => switchMode(AppMode.MERGE)} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${mode === AppMode.MERGE ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-800'}`}>ادغام</button>
          <button onClick={() => switchMode(AppMode.SPLIT)} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${mode === AppMode.SPLIT ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-800'}`}>جداکننده</button>
          <button onClick={() => switchMode(AppMode.IMG_TO_PDF)} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${mode === AppMode.IMG_TO_PDF ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-800'}`}>تصویر به PDF</button>
          <button onClick={() => switchMode(AppMode.PDF_TO_IMG)} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${mode === AppMode.PDF_TO_IMG ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-800'}`}>PDF به تصویر</button>
          <button onClick={() => switchMode(AppMode.TEXT_TOOLS)} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${mode === AppMode.TEXT_TOOLS ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-800'}`}>ابزار فایل txt</button>
        </div>

        <div className="hidden lg:flex gap-8 text-sm font-medium text-slate-500">
          <span className="text-xs self-center bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-bold">Secure Browser Processing</span>
        </div>
      </nav>

      <main className="max-w-6xl w-full py-12 px-6 flex flex-col lg:flex-row gap-10">
        <div className="flex-1 space-y-8">
          <header className="flex justify-between items-end">
            <div className="text-right w-full">
              <h1 className="text-3xl font-extrabold text-slate-800 mb-2">
                {mode === AppMode.MERGE && 'ترتیب فایل‌ها برای ادغام'}
                {mode === AppMode.SPLIT && 'انتخاب فایل برای جداسازی'}
                {mode === AppMode.IMG_TO_PDF && 'تبدیل تصاویر به یک PDF'}
                {mode === AppMode.PDF_TO_IMG && 'تبدیل صفحات PDF به تصویر'}
                {mode === AppMode.TEXT_TOOLS && 'مدیریت فایل‌های متنی (txt)'}
              </h1>
              <p className="text-slate-500 text-sm">
                {mode === AppMode.MERGE && 'اولویت ادغام را با جابجایی فایل‌ها مشخص کنید.'}
                {mode === AppMode.SPLIT && 'فایل PDF خود را انتخاب کنید و روش جداسازی را تعیین کنید.'}
                {mode === AppMode.IMG_TO_PDF && 'تصاویر JPG یا PNG خود را انتخاب کنید تا به PDF تبدیل شوند.'}
                {mode === AppMode.PDF_TO_IMG && 'فایل PDF را انتخاب کنید تا هر صفحه آن به صورت عکس استخراج شود.'}
                {mode === AppMode.TEXT_TOOLS && 'فایل‌های متنی (txt) را برای تبدیل به PDF یا ادغام بارگذاری کنید.'}
              </p>
            </div>
          </header>

          {(mode === AppMode.MERGE || mode === AppMode.IMG_TO_PDF || mode === AppMode.TEXT_TOOLS || (files.length === 0)) && (
            <div 
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileChange(e); }}
              onClick={() => fileInputRef.current?.click()}
              className={`
                relative overflow-hidden group border-2 border-dashed rounded-[2.5rem] p-12
                flex flex-col items-center justify-center transition-all duration-500 cursor-pointer
                ${isDragging 
                  ? 'border-indigo-500 bg-indigo-50/50 scale-[0.99] shadow-inner' 
                  : 'border-slate-300 bg-white hover:border-indigo-400 hover:shadow-2xl hover:shadow-indigo-100/30'
                }
              `}
            >
              <div className={`
                w-16 h-16 rounded-2xl flex items-center justify-center mb-4 transition-all duration-500
                ${isDragging ? 'bg-indigo-600 text-white rotate-12' : 'bg-slate-100 text-slate-400 group-hover:bg-indigo-600 group-hover:text-white'}
              `}>
                <PlusIcon className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-1">
                {getUploadText()}
              </h3>
              <p className="text-slate-400 text-sm text-center">
                {mode === AppMode.IMG_TO_PDF ? 'تصاویر خود را اینجا رها کنید' : (mode === AppMode.TEXT_TOOLS ? 'فایل‌های متنی (txt) را اینجا رها کنید' : 'فایل‌های PDF را اینجا رها کنید')}
              </p>
              <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple={mode === AppMode.MERGE || mode === AppMode.IMG_TO_PDF || mode === AppMode.TEXT_TOOLS} accept={getAcceptTypes()} className="hidden" />
            </div>
          )}

          {files.length > 0 && (
            <div className="grid grid-cols-1 gap-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {files.map((f, idx) => (
                <div key={f.id} className="file-card bg-white p-4 rounded-3xl border border-slate-200 flex items-center gap-5 relative group">
                  <div className="flex flex-col items-center gap-1 flex-shrink-0">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">FILE</span>
                    <div className="w-8 h-8 bg-indigo-600 text-white rounded-xl flex items-center justify-center font-black text-sm shadow-md shadow-indigo-100">
                      {idx + 1}
                    </div>
                  </div>

                  <div className={`w-12 h-12 ${f.file.type.startsWith('image/') ? 'bg-indigo-50 text-indigo-500' : 'bg-rose-50 text-rose-500'} rounded-2xl flex items-center justify-center flex-shrink-0`}>
                    <FileIcon className="w-6 h-6" />
                  </div>

                  <div className="flex-1 min-w-0 text-right">
                    <h4 className="font-bold text-slate-800 truncate text-base leading-tight" title={f.name}>{f.name}</h4>
                    <p className="text-xs text-slate-400 mt-1 font-medium">
                      {formatSize(f.size)} {f.pageCount ? `• ${f.pageCount} ${f.file.type.startsWith('image/') ? 'تصویر' : 'صفحه'}` : ''}
                    </p>
                  </div>

                  {(mode === AppMode.MERGE || mode === AppMode.IMG_TO_PDF || (mode === AppMode.TEXT_TOOLS && files.length > 1)) && (
                    <div className="flex items-center gap-1 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
                      <button onClick={(e) => { e.stopPropagation(); moveFile(idx, 'up'); }} disabled={idx === 0} className="p-2 hover:bg-white hover:shadow-sm rounded-xl text-slate-400 hover:text-indigo-600 disabled:opacity-20 transition-all"><svg className="w-5 h-5 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg></button>
                      <button onClick={(e) => { e.stopPropagation(); moveFile(idx, 'down'); }} disabled={idx === files.length - 1} className="p-2 hover:bg-white hover:shadow-sm rounded-xl text-slate-400 hover:text-indigo-600 disabled:opacity-20 transition-all"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg></button>
                    </div>
                  )}

                  <button onClick={(e) => { e.stopPropagation(); removeFile(f.id); }} className="w-10 h-10 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-2xl flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"><XIcon className="w-5 h-5" /></button>
                </div>
              ))}
            </div>
          )}

          {mode === AppMode.SPLIT && splitResults.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                 <h3 className="text-xl font-bold text-slate-800 text-right">نتایج جداسازی ({splitResults.length} فایل):</h3>
                 <button onClick={downloadAllAsZip} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-colors shadow-lg shadow-indigo-200 flex items-center gap-2">
                    <DownloadIcon className="w-4 h-4" />
                    <span>دانلود همه (ZIP)</span>
                 </button>
              </div>
              <div className={`grid gap-4 ${splitResults.length > 2 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'}`}>
                {splitResults.map((res, i) => (
                  <div key={i} className="bg-white p-4 rounded-[1.5rem] border border-slate-200 flex flex-col gap-3 group hover:border-emerald-300 transition-colors shadow-sm">
                    <p className="text-xs font-bold text-slate-800 truncate text-right">{res.name}</p>
                    <button onClick={() => downloadFile(res.blob, res.name)} className="w-full py-2 bg-emerald-50 text-emerald-600 rounded-xl group-hover:bg-emerald-500 group-hover:text-white transition-all flex items-center justify-center gap-2 text-xs font-black"><DownloadIcon className="w-4 h-4" /><span>دانلود</span></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {mode === AppMode.TEXT_TOOLS && (resultCount > 0 || mergedBlob || mergedTxtBlob) && (
             <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-slate-800 text-right">
                       {(mergedBlob || mergedTxtBlob) ? 'نتایج ادغام' : `نتایج استخراج (${resultCount} صفحه)`}
                    </h3>
                    {resultCount > 0 && (
                        <button onClick={downloadAllAsZip} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-colors shadow-lg shadow-indigo-200 flex items-center gap-2">
                            <DownloadIcon className="w-4 h-4" />
                            <span>دانلود همه (ZIP)</span>
                        </button>
                    )}
                </div>
                
                {(mergedBlob) && (
                    <div className="bg-white p-4 rounded-[1.5rem] border border-slate-200 flex flex-col gap-3">
                        <p className="text-xs font-bold text-slate-800 text-right">فایل نهایی (PDF)</p>
                        <button onClick={() => downloadFile(mergedBlob, `merged_text_${Date.now()}.pdf`)} className="w-full py-3 bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-500 hover:text-white transition-all flex items-center justify-center gap-2 text-xs font-black"><DownloadIcon className="w-4 h-4" /><span>دانلود PDF</span></button>
                    </div>
                )}

                {(mergedTxtBlob) && (
                     <div className="bg-white p-4 rounded-[1.5rem] border border-slate-200 flex flex-col gap-3">
                        <p className="text-xs font-bold text-slate-800 text-right">فایل نهایی (TXT)</p>
                        <button onClick={() => downloadFile(mergedTxtBlob, `merged_text_${Date.now()}.txt`)} className="w-full py-3 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-500 hover:text-white transition-all flex items-center justify-center gap-2 text-xs font-black"><DownloadIcon className="w-4 h-4" /><span>دانلود TXT</span></button>
                    </div>
                )}

                {resultCount > 0 && (
                    <div className={`grid gap-4 ${resultCount > 1 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'}`}>
                        {Array.from({ length: resultCount }).map((_, i) => {
                           const pdfRes = splitResults[i];
                           const txtRes = textSplitResults[i];
                           const name = pdfRes?.name || txtRes?.name || `Page ${i + 1}`;
                           
                           return (
                             <div key={i} className="bg-white p-4 rounded-[1.5rem] border border-slate-200 flex flex-col gap-3">
                                 <p className="text-xs font-bold text-slate-800 truncate text-right">{name}</p>
                                 <div className="grid grid-cols-1 gap-2">
                                     {pdfRes && (
                                         <button onClick={() => downloadFile(pdfRes.blob, pdfRes.name)} className="w-full py-2 bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-500 hover:text-white transition-all flex items-center justify-center gap-2 text-[10px] font-black"><DownloadIcon className="w-3 h-3" /><span>PDF</span></button>
                                     )}
                                     {txtRes && (
                                         <button onClick={() => downloadTextContent(txtRes.content, txtRes.name)} className="w-full py-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-500 hover:text-white transition-all flex items-center justify-center gap-2 text-[10px] font-black"><DownloadIcon className="w-3 h-3" /><span>TXT</span></button>
                                     )}
                                 </div>
                             </div>
                           );
                        })}
                    </div>
                )}
             </div>
          )}

          {mode === AppMode.PDF_TO_IMG && imageResults.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-slate-800">تصاویر استخراج شده ({imageResults.length} تصویر):</h3>
                <button onClick={openZipModal} disabled={calculatingZip} className={`px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-colors shadow-lg shadow-indigo-200 flex items-center gap-2 ${calculatingZip ? 'opacity-70 cursor-wait' : ''}`}>
                  {calculatingZip ? (<div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>) : (<DownloadIcon className="w-4 h-4" />)}
                  <span>{calculatingZip ? 'محاسبه حجم...' : 'دانلود همه (ZIP)'}</span>
                </button>
              </div>
              <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
                {imageResults.map((res, i) => (
                  <div key={i} className="bg-white p-3 rounded-3xl border border-slate-200 overflow-hidden group flex flex-col gap-3">
                    <div className="aspect-[3/4] bg-slate-100 rounded-2xl overflow-hidden relative">
                      <img src={res.dataUrl} alt={res.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-indigo-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button onClick={() => downloadDataUrl(res.dataUrl, res.name)} className="w-12 h-12 bg-white text-indigo-600 rounded-2xl flex items-center justify-center shadow-xl hover:scale-110 transition-transform"><DownloadIcon className="w-6 h-6" /></button>
                      </div>
                    </div>
                    <p className="text-[10px] font-bold text-slate-500 text-center truncate px-2">{res.name}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:w-80">
          <div className="flex flex-col gap-6 sticky top-28">
            <div className="glass-panel p-8 rounded-[2.5rem] shadow-2xl shadow-slate-200/50 border border-white">
              <h3 className="text-xl font-black text-slate-800 mb-6 flex items-center gap-2">
                <div className="w-1.5 h-6 bg-indigo-600 rounded-full"></div>
                پنل نهایی
              </h3>
              
              <div className="space-y-4 mb-6 bg-slate-50/50 p-5 rounded-3xl border border-slate-100">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-slate-400">تعداد فایل:</span>
                  <span className="text-slate-800 font-inter">{files.length}</span>
                </div>
                {mode !== AppMode.IMG_TO_PDF && (
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-slate-400">مجموع صفحات:</span>
                    <span className="text-slate-800 font-inter">{totalPages}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-slate-400">حجم حدودی:</span>
                  <span className="text-slate-800 font-inter">{formatSize(totalSize)}</span>
                </div>
              </div>
              
              {/* Text Tools Operation Toggle */}
              {mode === AppMode.TEXT_TOOLS && (
                  <div className="mb-6 p-1 bg-slate-100 rounded-2xl flex relative">
                      <button 
                         onClick={() => setTextToolOp('MERGE')}
                         className={`flex-1 py-3 text-xs font-bold rounded-xl transition-all z-10 ${textToolOp === 'MERGE' ? 'text-indigo-600 bg-white shadow-sm' : 'text-slate-400'}`}
                      >
                          ادغام
                      </button>
                      <button 
                         onClick={() => setTextToolOp('SPLIT')}
                         className={`flex-1 py-3 text-xs font-bold rounded-xl transition-all z-10 ${textToolOp === 'SPLIT' ? 'text-indigo-600 bg-white shadow-sm' : 'text-slate-400'}`}
                      >
                          جداکننده
                      </button>
                  </div>
              )}

              {((mode === AppMode.SPLIT && files.length === 1) || (mode === AppMode.TEXT_TOOLS && textToolOp === 'SPLIT')) && (
                <div className="space-y-6 mb-6 animate-in fade-in slide-in-from-top-2">
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block text-right">روش جداسازی</label>
                    <div className="grid grid-cols-1 gap-1 bg-slate-50 p-1 rounded-2xl">
                      <button onClick={() => setSplitSubMode('RANGE')} className={`py-2 px-3 rounded-xl text-xs font-bold transition-all text-right ${splitSubMode === 'RANGE' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>بازه انتخابی</button>
                      <button onClick={() => setSplitSubMode('PARTS')} className={`py-2 px-3 rounded-xl text-xs font-bold transition-all text-right ${splitSubMode === 'PARTS' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>تقسیم به بخش‌های مساوی</button>
                      <button onClick={() => setSplitSubMode('CUSTOM')} className={`py-2 px-3 rounded-xl text-xs font-bold transition-all text-right ${splitSubMode === 'CUSTOM' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>برش در صفحات خاص</button>
                      <button onClick={() => setSplitSubMode('ALL')} className={`py-2 px-3 rounded-xl text-xs font-bold transition-all text-right ${splitSubMode === 'ALL' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>جداسازی تمام صفحات</button>
                    </div>
                  </div>
                  {splitSubMode === 'RANGE' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div><input type="number" min="1" max={Math.max(...files.map(f => f.pageCount || 1))} value={pageRange.end} onChange={(e) => setPageRange(prev => ({ ...prev, end: parseInt(e.target.value) || 1 }))} className="w-full bg-white border border-slate-200 p-3 rounded-2xl text-center font-bold focus:ring-2 focus:ring-indigo-500 outline-none" /><span className="text-[10px] text-slate-400 text-center block mt-1">تا صفحه</span></div>
                      <div><input type="number" min="1" max={Math.max(...files.map(f => f.pageCount || 1))} value={pageRange.start} onChange={(e) => setPageRange(prev => ({ ...prev, start: parseInt(e.target.value) || 1 }))} className="w-full bg-white border border-slate-200 p-3 rounded-2xl text-center font-bold focus:ring-2 focus:ring-indigo-500 outline-none" /><span className="text-[10px] text-slate-400 text-center block mt-1">از صفحه</span></div>
                    </div>
                  )}
                  {splitSubMode === 'PARTS' && (
                    <div className="grid grid-cols-4 gap-2">
                      {[2, 3, 4, 5].map(n => (<button key={n} onClick={() => setPartsToSplit(n)} className={`py-3 rounded-xl text-xs font-bold transition-all ${partsToSplit === n ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'bg-white border border-slate-200 text-slate-500'}`}>{n}</button>))}
                    </div>
                  )}
                  {splitSubMode === 'CUSTOM' && (
                    <div className="text-right">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">شماره صفحات برای برش (با کاما جدا کنید)</label>
                      <input type="text" value={customSplitInput} onChange={(e) => setCustomSplitInput(e.target.value)} placeholder="مثلاً: 100, 250" className="w-full bg-white border border-slate-200 p-3 rounded-2xl text-center font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:font-normal placeholder:text-slate-300" dir="ltr" />
                      <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">فایل PDF بعد از هر شماره صفحه‌ای که وارد کنید برش می‌خورد و یک فایل جدید ایجاد می‌شود.</p>
                    </div>
                  )}
                </div>
              )}

              <button 
                onClick={handleAction}
                disabled={isActionDisabled()}
                className={`w-full py-5 px-6 rounded-[1.5rem] font-black text-white transition-all duration-300 flex items-center justify-center gap-3 shadow-2xl shadow-indigo-200/50 ${isActionDisabled() ? 'bg-slate-400 cursor-not-allowed scale-95' : 'bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98]'}`}
              >
                {getActionText()}
              </button>

              {status === AppStatus.SUCCESS && mergedBlob && (mode === AppMode.MERGE || mode === AppMode.IMG_TO_PDF) && (
                <button onClick={() => downloadFile(mergedBlob, `fusion_${Date.now()}.pdf`)} className="w-full mt-4 bg-emerald-500 hover:bg-emerald-600 py-5 px-6 rounded-[1.5rem] font-black text-white transition-all duration-300 flex items-center justify-center gap-3 shadow-2xl shadow-emerald-200/50 animate-pulse-soft"><DownloadIcon />دریافت فایل PDF</button>
              )}

              {files.length > 0 && (
                <button onClick={() => { setFiles([]); setStatus(AppStatus.IDLE); setMergedBlob(null); setMergedTxtBlob(null); setSplitResults([]); setImageResults([]); setTextSplitResults([]); setProgress(0); }} className="w-full mt-6 text-slate-400 hover:text-rose-500 text-[10px] font-black uppercase tracking-widest transition-colors">پاکسازی کل میزکار</button>
              )}
            </div>

            <div className="p-6 bg-indigo-50 border border-indigo-100 rounded-[2.5rem] shadow-xl shadow-indigo-100/20">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                </div>
                <h4 className="font-extrabold text-sm text-indigo-900">امنیت</h4>
              </div>
              <p className="text-[10px] text-indigo-700/70 leading-relaxed font-bold text-right">
                فایل‌های شما از مرورگر خارج نمی‌شوند. تمامی پردازش‌ها در حافظه موقت سیستم شما انجام می‌گردد.
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="mt-auto py-10 text-slate-400 text-[10px] font-bold tracking-widest text-center border-t border-slate-200 w-full bg-white/50">
        PDF FUSION WORKSPACE © {new Date().getFullYear()}
      </footer>
    </div>
  );
};

export default App;