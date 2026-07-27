import type { PortfolioData } from '../types'

const textEncoder = new TextEncoder()

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character] ?? character)
}

export function safeUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed)
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

export function safeColor(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : '#0f766e'
}

export function splitTags(value: string): string[] {
  return value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean)
}

export function joinTags(values: string[]): string {
  return values.join('，')
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase() || '我'
}

export function isValidImage(file: File): boolean {
  return file.type.startsWith('image/') && file.size <= 4 * 1024 * 1024
}

export function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

export function exportFileName(name: string): string {
  const normalized = name.trim().replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-+|-+$/g, '')
  return `${normalized || 'portfolio'}-index.html`
}

export function byteSize(value: string): number {
  return textEncoder.encode(value).length
}

export function createPortfolioHtml(data: PortfolioData): string {
  const name = escapeHtml(data.name || '我的主页')
  const headline = escapeHtml(data.headline)
  const bio = escapeHtml(data.bio).replace(/\n/g, '<br>')
  const avatar = data.avatar
    ? `<img class="avatar" src="${escapeHtml(data.avatar)}" alt="${name} 的头像">`
    : `<div class="avatar avatar-fallback" aria-label="${name}">${escapeHtml(initials(data.name))}</div>`
  const skills = data.skills.filter(Boolean).map((skill) => `<li>${escapeHtml(skill)}</li>`).join('')
  const projects = data.projects.map((project) => {
    const url = safeUrl(project.url)
    const media = project.image
      ? `<img src="${escapeHtml(project.image)}" alt="${escapeHtml(project.title)} 项目封面">`
      : `<div class="project-placeholder">${escapeHtml(initials(project.title))}</div>`
    const projectTitle = url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(project.title)} <span aria-hidden="true">↗</span></a>`
      : escapeHtml(project.title)
    return `<article class="project"><div class="project-media">${media}</div><div class="project-body"><p class="eyebrow">精选项目</p><h3>${projectTitle}</h3><p>${escapeHtml(project.description)}</p><ul class="tags">${project.tags.filter(Boolean).map((tag) => `<li>${escapeHtml(tag)}</li>`).join('')}</ul></div></article>`
  }).join('')
  const socialLinks = data.socials.map((social) => {
    const url = safeUrl(social.url)
    return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(social.label)}</a>` : ''
  }).join('')
  const email = data.email.trim()
  const emailLink = email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : ''
  const location = data.location.trim() ? `<span>${escapeHtml(data.location)}</span>` : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${name} 的个人主页">
  <title>${name} | 个人主页</title>
  <style>
    :root { --ink: #16201f; --muted: #68706e; --line: #d8ddda; --paper: #f8f7f2; --surface: #ffffff; --accent: ${safeColor(data.accentColor)}; }
    * { box-sizing: border-box; } body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; } a { color: inherit; text-underline-offset: 4px; } .wrap { width: min(1120px, calc(100% - 48px)); margin: auto; } .top { display: flex; justify-content: space-between; align-items: center; padding: 28px 0; font-size: 14px; } .top strong { letter-spacing: 0; } .top a { color: var(--muted); text-decoration: none; } .intro { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 72px; align-items: center; padding: 96px 0 112px; } .eyebrow { margin: 0 0 12px; color: var(--accent); font-size: 13px; font-weight: 700; letter-spacing: 0; text-transform: uppercase; } h1 { max-width: 780px; margin: 0; font-size: clamp(38px, 6vw, 76px); line-height: 1.06; letter-spacing: 0; } h2 { margin: 0; font-size: clamp(29px, 4vw, 46px); line-height: 1.15; letter-spacing: 0; } h3 { margin: 0 0 10px; font-size: 24px; line-height: 1.25; letter-spacing: 0; } .bio { max-width: 620px; margin: 28px 0 0; color: var(--muted); font-size: 18px; } .avatar { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; border-radius: 4px; background: #e3ebe7; } .avatar-fallback { display: grid; place-items: center; color: var(--accent); font-size: 76px; font-weight: 700; } section { border-top: 1px solid var(--line); padding: 88px 0; } .split { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 56px; } .skills, .tags, .contact-links { display: flex; flex-wrap: wrap; gap: 10px; padding: 0; margin: 0; list-style: none; } .skills li, .tags li { border: 1px solid var(--line); border-radius: 999px; padding: 6px 12px; color: var(--muted); font-size: 14px; } .projects { display: grid; gap: 28px; } .project { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 28px; padding: 0 0 28px; border-bottom: 1px solid var(--line); } .project:last-child { border-bottom: 0; padding-bottom: 0; } .project-media { aspect-ratio: 4 / 3; overflow: hidden; background: #e3ebe7; } .project-media img { width: 100%; height: 100%; display: block; object-fit: cover; } .project-placeholder { display: grid; width: 100%; height: 100%; place-items: center; color: var(--accent); font-size: 36px; font-weight: 700; } .project-body > p:not(.eyebrow) { margin: 0 0 18px; color: var(--muted); } .contact { display: grid; grid-template-columns: 1fr auto; gap: 32px; align-items: end; } .contact h2 { max-width: 600px; } .contact-links { display: grid; justify-items: end; gap: 8px; color: var(--muted); } footer { border-top: 1px solid var(--line); padding: 28px 0 48px; color: var(--muted); font-size: 14px; } @media (max-width: 700px) { .wrap { width: min(100% - 32px, 1120px); } .intro { grid-template-columns: 1fr; gap: 36px; padding: 64px 0 72px; } .avatar { width: min(220px, 60vw); } section { padding: 64px 0; } .split, .project, .contact { grid-template-columns: 1fr; gap: 24px; } .contact-links { justify-items: start; } .project-media { max-width: 420px; } }
  </style>
</head>
<body>
  <header class="wrap top"><strong>${name}</strong><a href="#contact">联系我</a></header>
  <main class="wrap">
    <section class="intro"><div><p class="eyebrow">个人主页</p><h1>${headline}</h1><p class="bio">${bio}</p></div>${avatar}</section>
    <section class="split"><h2>我擅长的事</h2><ul class="skills">${skills}</ul></section>
    <section class="split"><h2>项目作品</h2><div class="projects">${projects || '<p>项目即将发布。</p>'}</div></section>
    <section id="contact" class="contact"><div><p class="eyebrow">保持联系</p><h2>有想法，欢迎来信。</h2></div><div class="contact-links">${emailLink}${location}${socialLinks}</div></section>
  </main>
  <footer class="wrap">© ${new Date().getFullYear()} ${name}</footer>
</body>
</html>`
}
