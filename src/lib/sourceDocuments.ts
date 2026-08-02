import type JSZip from 'jszip'
import type { JSZipObject } from 'jszip'
import type { AiDocumentImage, AiSourceDocument } from '../types'

export const MAX_SOURCE_DOCUMENTS = 3
export const MAX_SOURCE_DOCUMENT_BYTES = 10 * 1024 * 1024
export const MAX_SOURCE_DOCUMENT_TOTAL_BYTES = 20 * 1024 * 1024
export const MAX_DOCUMENT_IMAGES = 6
export const MAX_DOCUMENT_IMAGE_BYTES = 4 * 1024 * 1024
export const MAX_DOCUMENT_IMAGE_TOTAL_BYTES = 8 * 1024 * 1024
export const SOURCE_DOCUMENT_ACCEPT = '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain'

type SourceDocumentMime = AiSourceDocument['mimeType']

const MIME_BY_EXTENSION: Record<string, SourceDocumentMime> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain'
}

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}

export function sourceDocumentError(file: File): string | null {
  const extension = fileExtension(file.name)
  if (!MIME_BY_EXTENSION[extension]) return '仅支持 PDF、DOCX 和 TXT 文件。'
  if (!file.size) return '资料文件不能为空。'
  if (file.size > MAX_SOURCE_DOCUMENT_BYTES) return '单个资料文件不能超过 10MB。'
  if (file.name.trim().length > 200) return '资料文件名不能超过 200 个字符。'
  return null
}

export async function prepareAiSourceDocument(file: File, id: string): Promise<AiSourceDocument> {
  const error = sourceDocumentError(file)
  if (error) throw new Error(error)

  const extension = fileExtension(file.name)
  const mimeType = MIME_BY_EXTENSION[extension]
  const bytes = new Uint8Array(await readFileAsArrayBuffer(file))
  let links: string[] = []
  let images: AiDocumentImage[] = []
  let omittedImages = 0

  if (extension === 'txt') {
    links = extractLinksFromText(new TextDecoder().decode(bytes))
  } else if (extension === 'docx') {
    const extracted = await extractDocxMetadata(bytes)
    links = extracted.links
    images = extracted.images
    omittedImages = extracted.omittedImages
  }

  return {
    id,
    name: file.name,
    mimeType,
    src: await bytesToDataUrl(bytes, mimeType),
    bytes: file.size,
    links,
    images,
    omittedImages
  }
}

export function extractLinksFromText(text: string): string[] {
  const matches = text.match(/(?:https?:\/\/|mailto:)[^\s<>"'，。；！？、（）《》【】]+/gi) ?? []
  return uniqueLinks(matches)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kilobytes = bytes / 1024
  if (kilobytes < 1024) return `${kilobytes.toFixed(kilobytes >= 100 ? 0 : 1)} KB`
  return `${(kilobytes / 1024).toFixed(1)} MB`
}

async function extractDocxMetadata(bytes: Uint8Array): Promise<{ links: string[]; images: AiDocumentImage[]; omittedImages: number }> {
  let zip: JSZip
  try {
    const { default: JSZipLoader } = await import('jszip')
    zip = await JSZipLoader.loadAsync(bytes)
  } catch {
    throw new Error('DOCX 文件无法读取，请确认文件未损坏。')
  }

  const links: string[] = []
  const relationshipPaths = Object.keys(zip.files)
    .filter((path) => /^word\/(?:[^/]+\/)?_rels\/[^/]+\.rels$/i.test(path))
    .slice(0, 20)

  for (const path of relationshipPaths) {
    const entry = zip.file(path)
    if (!entry || uncompressedSize(entry) > 512 * 1024) continue
    const xml = await entry.async('string')
    if (xml.length > 512 * 1024) continue
    links.push(...extractLinksFromRelationships(xml))
  }

  const images: AiDocumentImage[] = []
  let imageBytes = 0
  let omittedImages = 0
  const mediaPaths = Object.keys(zip.files)
    .filter((path) => path.startsWith('word/media/') && !zip.files[path].dir)
    .sort()

  for (const path of mediaPaths) {
    const entry = zip.file(path)
    const mimeType = imageMimeType(path)
    if (!entry || !mimeType || images.length >= MAX_DOCUMENT_IMAGES || uncompressedSize(entry) > MAX_DOCUMENT_IMAGE_BYTES) {
      omittedImages += 1
      continue
    }

    const image = await entry.async('uint8array')
    if (!isSupportedImageBytes(image, mimeType)
      || image.byteLength > MAX_DOCUMENT_IMAGE_BYTES
      || imageBytes + image.byteLength > MAX_DOCUMENT_IMAGE_TOTAL_BYTES) {
      omittedImages += 1
      continue
    }

    images.push({
      name: path.split('/').pop() || `image-${images.length + 1}`,
      src: await bytesToDataUrl(image, mimeType),
      bytes: image.byteLength
    })
    imageBytes += image.byteLength
  }

  return { links: uniqueLinks(links), images, omittedImages }
}

function extractLinksFromRelationships(xml: string): string[] {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.querySelector('parsererror')) return []

  return Array.from(document.getElementsByTagNameNS('*', 'Relationship'))
    .filter((relationship) => relationship.getAttribute('Type')?.endsWith('/hyperlink'))
    .map((relationship) => relationship.getAttribute('Target') ?? '')
}

function uniqueLinks(values: string[]): string[] {
  const links = new Set<string>()
  for (const value of values) {
    const normalized = normalizeLink(value)
    if (normalized) links.add(normalized)
    if (links.size >= 40) break
  }
  return [...links]
}

function normalizeLink(value: string): string {
  const trimmed = value.trim().replace(/[),.;!?\]}，。；！？、）》】]+$/u, '')
  if (!trimmed || trimmed.length > 2048) return ''
  try {
    const url = new URL(trimmed)
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

function fileExtension(name: string): string {
  return name.trim().toLowerCase().split('.').pop() ?? ''
}

function imageMimeType(name: string): string {
  return IMAGE_MIME_BY_EXTENSION[fileExtension(name)] ?? ''
}

function uncompressedSize(entry: JSZipObject): number {
  const internal = entry as JSZipObject & { _data?: { uncompressedSize?: number } }
  return internal._data?.uncompressedSize ?? 0
}

function isSupportedImageBytes(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/png') {
    return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
  }
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (mimeType === 'image/webp') {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  }
  return false
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(new Error('资料文件读取失败。'))
    reader.readAsArrayBuffer(file)
  })
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('资料文件编码失败。'))
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    reader.readAsDataURL(new Blob([buffer], { type: mimeType }))
  })
}
