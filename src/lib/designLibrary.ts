import { generate, parse, walk } from 'css-tree'
import type { WebDesignSource } from '../types'

export const DESIGN_LIBRARY_STORAGE_KEY = 'portfolio-forge-design-library-v1'
export const MAX_DESIGN_LIBRARY_ITEMS = 8
export const MAX_DESIGN_SOURCE_FILE_BYTES = 768 * 1024
export const MAX_DESIGN_LIBRARY_TOTAL_BYTES = 2 * 1024 * 1024
export const WEB_DESIGN_SOURCE_ACCEPT = '.html,.htm,text/html'

const BLOCKED_ELEMENTS = 'script,noscript,iframe,object,embed,form,input,textarea,select,option,meta,link,base,svg,math'
const BLOCKED_AT_RULES = new Set(['import', 'font-face', 'namespace', 'document', 'charset'])
const BLOCKED_FUNCTIONS = new Set(['url', 'image', 'image-set', '-webkit-image-set', 'expression'])
const BLOCKED_DECLARATIONS = new Set(['behavior', '-moz-binding', 'src'])
const textEncoder = new TextEncoder()

export function designSourceFileError(file: File): string {
  const extension = file.name.trim().toLowerCase().split('.').pop()
  if (!['html', 'htm'].includes(extension ?? '')) return '网页库仅支持 .html 或 .htm 文件。'
  if (file.size > MAX_DESIGN_SOURCE_FILE_BYTES) return '单个网页设计文件不能超过 768KB。'
  return ''
}

export async function prepareWebDesignSource(file: File, id: string): Promise<WebDesignSource> {
  const error = designSourceFileError(file)
  if (error) throw new Error(error)

  const source = await readFileAsText(file)
  const document = new DOMParser().parseFromString(source, 'text/html')
  const rawCss = Array.from(document.querySelectorAll('style')).map((style) => style.textContent ?? '').join('\n')
  const css = sanitizeReferenceCss(rawCss)
  const previewBody = document.body.cloneNode(true) as HTMLElement
  sanitizeReferenceBody(previewBody)

  if (!previewBody.textContent?.trim() && !previewBody.children.length) {
    throw new Error('网页文件中没有可提取的正文结构。')
  }

  const bodyHtml = createStructureHtml(previewBody)
  const previewHtml = previewBody.innerHTML
  const bytes = textEncoder.encode(`${bodyHtml}\n${css}`).byteLength
  const storageBytes = textEncoder.encode(`${bodyHtml}\n${previewHtml}\n${css}`).byteLength
  if (bytes > MAX_DESIGN_SOURCE_FILE_BYTES) throw new Error('提取后的网页结构与 CSS 超过 768KB 限制。')

  const title = document.title.trim().replace(/\s+/g, ' ').slice(0, 80)
  const name = title || file.name.replace(/\.html?$/i, '').slice(0, 80) || '未命名网页'
  const tags = inferDesignTags(previewBody, css)
  const sectionCount = previewBody.querySelectorAll('header,main,section,article,footer').length

  return {
    id,
    name,
    description: sectionCount ? `提取了 ${sectionCount} 个页面区块和内嵌样式` : '已提取页面结构和内嵌样式',
    tags,
    bodyHtml,
    previewHtml,
    css,
    importedAt: new Date().toISOString(),
    bytes,
    storageBytes
  }
}

export function normalizeDesignLibrary(candidate: unknown): WebDesignSource[] {
  if (!Array.isArray(candidate)) return []
  const normalized: WebDesignSource[] = []
  let totalBytes = 0

  for (const item of candidate) {
    if (!item || typeof item !== 'object' || normalized.length >= MAX_DESIGN_LIBRARY_ITEMS) break
    const source = item as Partial<WebDesignSource>
    if (typeof source.id !== 'string'
      || typeof source.name !== 'string'
      || typeof source.description !== 'string'
      || !Array.isArray(source.tags)
      || typeof source.bodyHtml !== 'string'
      || typeof source.previewHtml !== 'string'
      || typeof source.css !== 'string'
      || typeof source.importedAt !== 'string'
      || typeof source.bytes !== 'number'
      || typeof source.storageBytes !== 'number'
      || source.bytes <= 0
      || source.bytes > MAX_DESIGN_SOURCE_FILE_BYTES
      || source.storageBytes <= 0) continue

    const persistedBytes = textEncoder.encode(`${source.bodyHtml}\n${source.css}`).byteLength
    const persistedStorageBytes = textEncoder.encode(`${source.bodyHtml}\n${source.previewHtml}\n${source.css}`).byteLength
    if (persistedBytes !== source.bytes || persistedStorageBytes !== source.storageBytes) continue

    let css: string
    try {
      css = sanitizeReferenceCss(source.css)
    } catch {
      continue
    }
    const actualBytes = textEncoder.encode(`${source.bodyHtml}\n${css}`).byteLength
    const actualStorageBytes = textEncoder.encode(`${source.bodyHtml}\n${source.previewHtml}\n${css}`).byteLength
    if (totalBytes + actualStorageBytes > MAX_DESIGN_LIBRARY_TOTAL_BYTES) continue
    normalized.push({
      id: source.id.slice(0, 120),
      name: source.name.slice(0, 80),
      description: source.description.slice(0, 160),
      tags: source.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 8).map((tag) => tag.slice(0, 40)),
      bodyHtml: source.bodyHtml,
      previewHtml: source.previewHtml,
      css,
      importedAt: Number.isNaN(Date.parse(source.importedAt)) ? new Date(0).toISOString() : source.importedAt,
      bytes: actualBytes,
      storageBytes: actualStorageBytes
    })
    totalBytes += actualStorageBytes
  }
  return normalized
}

export function createDesignSourcePreviewHtml(source: WebDesignSource): string {
  const csp = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; form-action 'none'; frame-src 'none'"
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${source.css}</style></head><body>${source.previewHtml}</body></html>`
}

function sanitizeReferenceBody(root: HTMLElement) {
  root.querySelectorAll(BLOCKED_ELEMENTS).forEach((element) => element.remove())
  root.querySelectorAll('style').forEach((element) => element.remove())

  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on')
        || ['src', 'srcset', 'href', 'action', 'formaction', 'nonce', 'integrity', 'crossorigin'].includes(name)
        || (name === 'style' && /(?:url|expression)\s*\(/i.test(attribute.value))) {
        element.removeAttribute(attribute.name)
      }
    }
  }

  const comments = root.ownerDocument.createTreeWalker(root, 128)
  const nodes: Comment[] = []
  while (comments.nextNode()) nodes.push(comments.currentNode as Comment)
  nodes.forEach((node) => node.remove())
}

function createStructureHtml(previewBody: HTMLElement): string {
  const structure = previewBody.cloneNode(true) as HTMLElement
  for (const element of Array.from(structure.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      if (!['id', 'class', 'role', 'aria-hidden', 'style'].includes(attribute.name)) {
        element.removeAttribute(attribute.name)
      }
    }
  }

  const texts = structure.ownerDocument.createTreeWalker(structure, 4)
  const nodes: Text[] = []
  while (texts.nextNode()) nodes.push(texts.currentNode as Text)
  nodes.forEach((node) => {
    if (!node.textContent?.trim()) {
      node.remove()
      return
    }
    const tagName = node.parentElement?.tagName ?? ''
    node.textContent = /^H[1-3]$/.test(tagName) ? '标题' : tagName === 'A' ? '链接' : '内容'
  })
  return structure.innerHTML
}

function sanitizeReferenceCss(value: string): string {
  if (!value.trim()) return ''
  let syntaxTree
  try {
    syntaxTree = parse(value, { context: 'stylesheet' })
  } catch {
    throw new Error('网页文件中的内嵌 CSS 无法解析。')
  }

  walk(syntaxTree, {
    visit: 'Atrule',
    enter(node, item, list) {
      if (item && list && BLOCKED_AT_RULES.has(node.name.toLowerCase())) list.remove(item)
    }
  })
  walk(syntaxTree, {
    visit: 'Declaration',
    enter(node, item, list) {
      let blocked = BLOCKED_DECLARATIONS.has(node.property.toLowerCase())
      walk(node.value, (child) => {
        if (child.type === 'Url' || (child.type === 'Function' && BLOCKED_FUNCTIONS.has(child.name.toLowerCase()))) {
          blocked = true
        }
      })
      const serializedValue = generate(node.value).toLowerCase()
      if ([...BLOCKED_FUNCTIONS].some((name) => serializedValue.includes(`${name}(`))) {
        blocked = true
      }
      if (blocked && item && list) list.remove(item)
    }
  })
  const sanitized = generate(syntaxTree)
  if ([...BLOCKED_FUNCTIONS].some((name) => sanitized.toLowerCase().includes(`${name}(`))) {
    throw new Error('网页文件中的内嵌 CSS 包含无法安全清理的外链资源。')
  }
  return sanitized
}

function inferDesignTags(body: HTMLElement, css: string): string[] {
  const tags = new Set<string>()
  const normalizedCss = css.toLowerCase()
  if (body.querySelector('main,section,article')) tags.add('内容分区')
  if (normalizedCss.includes('display:grid')) tags.add('网格布局')
  if (normalizedCss.includes('position:sticky') || normalizedCss.includes('position:fixed')) tags.add('沉浸滚动')
  if (normalizedCss.includes('animation:') || normalizedCss.includes('@keyframes')) tags.add('动态视觉')
  if (normalizedCss.includes('serif')) tags.add('编辑排版')
  if (/background(?:-color)?:#(?:(?:0|1|2)[0-9a-f]{5}|(?:0|1|2)[0-9a-f]{2})\b/.test(normalizedCss)) tags.add('深色界面')
  if (body.querySelector('header,nav')) tags.add('完整导航')
  if (!tags.size) tags.add('网页设计')
  return [...tags].slice(0, 6)
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('网页设计文件读取失败。'))
    reader.readAsText(file)
  })
}
