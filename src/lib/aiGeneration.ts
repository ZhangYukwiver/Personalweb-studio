import type { AiAttachment, AiProviderConfig, GeneratePageDesignRequest, GeneratedPageDesign, PortfolioData } from '../types'

const MAX_AI_IMAGE_DIMENSION = 1920
const AI_IMAGE_QUALITY = 0.88
export const DEFAULT_AI_PROVIDER: AiProviderConfig = {
  baseUrl: 'https://ai.input.im/v1',
  model: 'gpt-5.6-sol',
  apiFormat: 'responses'
}

export function createAiGenerationRequest(
  data: PortfolioData,
  prompt: string,
  attachments: AiAttachment[]
): GeneratePageDesignRequest {
  return {
    prompt: prompt.trim(),
    profile: {
      name: data.name,
      headline: data.headline,
      bio: data.bio,
      email: data.email,
      location: data.location,
      accentColor: data.accentColor,
      hasAvatar: Boolean(data.avatar),
      skills: data.skills.filter(Boolean),
      projects: data.projects.map((project) => ({
        title: project.title,
        description: project.description,
        tags: project.tags.filter(Boolean),
        hasImage: Boolean(project.image)
      })),
      socials: data.socials.map((social) => ({ label: social.label, url: social.url }))
    },
    attachments: attachments.map(({ name, src, intent, bytes }) => ({ name, src, intent, bytes }))
  }
}

export async function compressAiImage(file: File): Promise<{ src: string; bytes: number }> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await loadImage(objectUrl)
    const scale = Math.min(1, MAX_AI_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法压缩截图')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await canvasToBlob(canvas)
    return { src: await blobToDataUrl(blob), bytes: blob.size }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function generatePageDesign(
  request: GeneratePageDesignRequest,
  apiKey: string,
  provider: AiProviderConfig
): Promise<GeneratedPageDesign> {
  if (!('__TAURI_INTERNALS__' in window)) {
    throw new Error('真实 AI 生成需要在桌面应用中运行。')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<GeneratedPageDesign>('generate_page_design', { request, apiKey, provider })
}

export function aiEndpoint(provider: AiProviderConfig): string {
  if (!/^\S{1,200}$/.test(provider.model.trim())) throw new Error('请输入有效的模型名称。')

  let url: URL
  try {
    url = new URL(provider.baseUrl.trim())
  } catch {
    throw new Error('请输入有效的 API Base URL。')
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error('API Base URL 不能包含账号、查询参数或锚点。')
  }
  const host = url.hostname.toLowerCase()
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('公网 AI 接口必须使用 HTTPS；HTTP 仅允许本机地址。')
  }

  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/(?:responses|chat\/completions)$/, '')
  const endpointPath = provider.apiFormat === 'responses' ? 'responses' : 'chat/completions'
  url.pathname = `${path}/${endpointPath}`
  return url.toString()
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('截图解码失败'))
    image.src = src
  })
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('截图压缩失败'))
    }, 'image/jpeg', AI_IMAGE_QUALITY)
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('截图读取失败'))
    reader.readAsDataURL(blob)
  })
}
