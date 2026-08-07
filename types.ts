
export interface PDFFile {
  id: string;
  file: File;
  name: string;
  size: number;
  previewUrl?: string;
  pageCount?: number;
}

export enum AppStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}

export enum AppMode {
  MERGE = 'MERGE',
  SPLIT = 'SPLIT',
  PDF_TO_IMG = 'PDF_TO_IMG',
  IMG_TO_PDF = 'IMG_TO_PDF',
  TEXT_TOOLS = 'TEXT_TOOLS'
}
