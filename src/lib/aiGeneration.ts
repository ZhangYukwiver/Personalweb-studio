import type {
  AiAttachment,
  AiGenerationCandidate,
  AiProfileCandidate,
  AiProviderConfig,
  AiSourceDocument,
  GeneratePageDesignRequest,
  PortfolioData
} from '../types'
import { safeUrl } from './portfolio'

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
  attachments: AiAttachment[],
  documents: AiSourceDocument[] = []
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
        hasImage: Boolean(project.image),
        url: project.url
      })),
      socials: data.socials.map((social) => ({ label: social.label, url: social.url }))
    },
    attachments: attachments.map(({ name, src, intent, bytes }) => ({ name, src, intent, bytes })),
    documents: documents.map(({ name, mimeType, src, bytes, links, images }) => ({ name, mimeType, src, bytes, links, images }))
  }
}

export function createCurrentProfileCandidate(data: PortfolioData): AiProfileCandidate {
  return {
    name: data.name,
    headline: data.headline,
    bio: data.bio,
    email: data.email,
    location: data.location,
    skills: [...data.skills],
    projects: data.projects.map(({ title, description, tags, url }) => ({
      title,
      description,
      tags: [...tags],
      url
    })),
    socials: data.socials.map(({ label, url }) => ({ label, url }))
  }
}

export function createCandidatePortfolio(data: PortfolioData, candidate: AiGenerationCandidate): PortfolioData {
  const usedProjectIds = new Set<string>()
  const usedSocialIds = new Set<string>()

  return {
    ...data,
    name: candidate.profile.name.trim(),
    headline: candidate.profile.headline.trim(),
    bio: candidate.profile.bio.trim(),
    email: candidate.profile.email.trim(),
    location: candidate.profile.location.trim(),
    skills: candidate.profile.skills.map((skill) => skill.trim()).filter(Boolean),
    projects: candidate.profile.projects.map((project, index) => {
      const existing = matchExistingItem(data.projects, project.title, index, usedProjectIds)
      if (existing) usedProjectIds.add(existing.id)
      return {
        id: existing?.id ?? `ai-project-${index + 1}`,
        title: project.title.trim(),
        description: project.description.trim(),
        tags: project.tags.map((tag) => tag.trim()).filter(Boolean),
        image: existing?.image,
        url: safeUrl(project.url)
      }
    }),
    socials: candidate.profile.socials.map((social, index) => {
      const existing = matchExistingItem(data.socials, social.label, index, usedSocialIds)
      if (existing) usedSocialIds.add(existing.id)
      return {
        id: existing?.id ?? `ai-social-${index + 1}`,
        label: social.label.trim(),
        url: safeUrl(social.url)
      }
    }),
    templateId: 'generated',
    generatedDesign: candidate.design
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
): Promise<AiGenerationCandidate> {
  if (!('__TAURI_INTERNALS__' in window)) {
    throw new Error('真实 AI 生成需要在桌面应用中运行。')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<AiGenerationCandidate>('generate_page_design', { request, apiKey, provider })
}

function matchExistingItem<T extends { id: string }>(
  items: T[],
  candidateLabel: string,
  index: number,
  usedIds: Set<string>
): T | undefined {
  const label = candidateLabel.trim().toLocaleLowerCase()
  const exact = items.find((item) => {
    const value = 'title' in item ? item.title : 'label' in item ? item.label : ''
    return !usedIds.has(item.id) && String(value).trim().toLocaleLowerCase() === label
  })
  if (exact) return exact

  const positional = items[index]
  return positional && !usedIds.has(positional.id) ? positional : undefined
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
