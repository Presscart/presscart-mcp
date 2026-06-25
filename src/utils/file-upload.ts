import { Buffer } from 'node:buffer';

export const ACCEPTED_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
] as const;

const ACCEPTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'doc', 'docx', 'pdf']);
const QUESTIONNAIRE_MIME_TYPES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
]);
const MAX_UPLOAD_FILES = 5;
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export type UploadFileInput = {
  file_name: string;
  mime_type: (typeof ACCEPTED_UPLOAD_MIME_TYPES)[number];
  content_base64: string;
};

export function buildUploadFormData(files: UploadFileInput[], folderId?: string) {
  if (!files.length) throw new Error('At least one file is required.');
  if (files.length > MAX_UPLOAD_FILES) throw new Error(`Cannot upload more than ${MAX_UPLOAD_FILES} files.`);

  const formData = new FormData();

  for (const file of files) {
    const bytes = decodeBase64File(file.content_base64);
    validateUploadFile(file, bytes.byteLength);
    formData.append('files', new File([bytes], file.file_name, { type: file.mime_type }));
  }

  if (folderId) {
    formData.append('folder_id', folderId);
  }

  return formData;
}

export function assertQuestionnaireFile(fileName: string, mimeType: string) {
  const extension = getExtension(fileName);
  if (!QUESTIONNAIRE_MIME_TYPES.has(mimeType) || !['doc', 'docx', 'pdf'].includes(extension)) {
    throw new Error('Questionnaire uploads only support PDF, DOC, and DOCX files.');
  }
}

export function assertGoogleDocUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('google_doc_url must be a valid URL.');
  }

  if (parsed.protocol !== 'https:' || parsed.hostname !== 'docs.google.com') {
    throw new Error('google_doc_url must be an HTTPS Google Docs URL.');
  }
}

function validateUploadFile(file: UploadFileInput, size: number) {
  const extension = getExtension(file.file_name);
  if (!ACCEPTED_EXTENSIONS.has(extension)) {
    throw new Error('Unsupported file extension. Use JPG, JPEG, PNG, PDF, DOC, or DOCX.');
  }

  if (!ACCEPTED_UPLOAD_MIME_TYPES.includes(file.mime_type)) {
    throw new Error('Unsupported file MIME type. Use JPG, JPEG, PNG, PDF, DOC, or DOCX.');
  }

  const maxBytes = file.mime_type.startsWith('image/') ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
  if (size > maxBytes) {
    const maxMb = maxBytes / (1024 * 1024);
    throw new Error(`${file.file_name} exceeds the ${maxMb}MB upload limit.`);
  }
}

function decodeBase64File(contentBase64: string) {
  const normalized = contentBase64.includes(',')
    ? contentBase64.slice(contentBase64.indexOf(',') + 1)
    : contentBase64;
  const bytes = Buffer.from(normalized, 'base64');

  if (!bytes.length) {
    throw new Error('content_base64 must contain file data.');
  }

  return bytes;
}

function getExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}
