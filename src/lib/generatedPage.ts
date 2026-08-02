import { generate, parse, walk } from 'css-tree'
import type { GeneratedEffect, GeneratedEffectType, GeneratedPageDesign, PortfolioData, Project } from '../types'

export const GENERATED_HTML_LIMIT = 100_000
export const GENERATED_CSS_LIMIT = 150_000
export const GENERATED_EFFECT_LIMIT = 32

const SLOT_NAMES = ['name', 'headline', 'bio', 'avatar', 'skills', 'projects', 'contact'] as const
const REQUIRED_SLOTS = ['name', 'headline', 'bio', 'skills', 'projects', 'contact'] as const
const EFFECT_TYPES = new Set<GeneratedEffectType>([
  'reveal', 'parallax', 'sticky', 'marquee', 'section-snap', 'media-swap', 'scene-pin', 'particle-field'
])
const EFFECT_TYPE_LIMITS: Partial<Record<GeneratedEffectType, number>> = {
  'media-swap': 2,
  'scene-pin': 4,
  'particle-field': 2
}
const ALLOWED_TAGS = new Set([
  'HEADER', 'MAIN', 'SECTION', 'ARTICLE', 'DIV', 'NAV', 'FOOTER', 'H1', 'H2', 'H3', 'P', 'SPAN',
  'UL', 'OL', 'LI', 'A', 'STRONG', 'EM', 'SMALL', 'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION', 'HR'
])
const ALLOWED_ATTRIBUTES = new Set(['id', 'class', 'href', 'target', 'rel', 'aria-label', 'aria-hidden', 'role', 'data-slot'])
const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION', 'META', 'LINK', 'BASE', 'SVG', 'MATH'])
const BLOCKED_AT_RULES = new Set(['import', 'font-face', 'namespace', 'document', 'charset'])
const BLOCKED_FUNCTIONS = new Set(['url', 'image', 'image-set', '-webkit-image-set', 'expression'])

export type SanitizedGeneratedDesign = {
  design: GeneratedPageDesign
  warnings: string[]
}

function safeExternalUrl(value: string): string {
  try {
    const url = new URL(value)
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

function normalizeIdentifier(value: string): string {
  return /^[A-Za-z][\w:-]{0,63}$/.test(value) ? value : ''
}

function sanitizeBodyHtml(value: string): { html: string; ids: Set<string>; slots: Set<string>; warnings: string[] } {
  if (value.length > GENERATED_HTML_LIMIT) throw new Error('生成的页面结构超过 100KB 限制。')

  const template = document.createElement('template')
  template.innerHTML = value
  const warnings: string[] = []

  for (const element of Array.from(template.content.querySelectorAll('*'))) {
    if (DROP_WITH_CONTENT.has(element.tagName)) {
      element.remove()
      warnings.push(`已移除不允许的 ${element.tagName.toLowerCase()} 元素。`)
      continue
    }

    if (!ALLOWED_TAGS.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes))
      warnings.push(`已展开不支持的 ${element.tagName.toLowerCase()} 元素。`)
      continue
    }

    for (const attribute of Array.from(element.attributes)) {
      if (!ALLOWED_ATTRIBUTES.has(attribute.name)) element.removeAttribute(attribute.name)
    }

    if (element.hasAttribute('id')) {
      const id = normalizeIdentifier(element.getAttribute('id') ?? '')
      if (id) element.id = id
      else element.removeAttribute('id')
    }

    if (element.hasAttribute('data-slot')) {
      const slot = element.getAttribute('data-slot')
      if (!SLOT_NAMES.includes(slot as typeof SLOT_NAMES[number])) element.removeAttribute('data-slot')
    }

    if (element.tagName === 'A') {
      const href = safeExternalUrl(element.getAttribute('href') ?? '')
      if (href) {
        element.setAttribute('href', href)
        element.setAttribute('target', '_blank')
        element.setAttribute('rel', 'noreferrer')
      } else {
        element.removeAttribute('href')
        element.removeAttribute('target')
        element.removeAttribute('rel')
      }
    }
  }

  const ids = new Set<string>()
  for (const element of Array.from(template.content.querySelectorAll('[id]'))) {
    if (ids.has(element.id)) {
      element.removeAttribute('id')
      warnings.push(`已移除重复的元素 ID：${element.id}。`)
    } else {
      ids.add(element.id)
    }
  }

  const slots = new Set(Array.from(template.content.querySelectorAll('[data-slot]')).map((element) => element.getAttribute('data-slot') ?? ''))
  const missingSlots = REQUIRED_SLOTS.filter((slot) => !slots.has(slot))
  if (missingSlots.length) throw new Error(`生成结果缺少必要数据槽：${missingSlots.join('、')}。`)

  return { html: template.innerHTML, ids, slots, warnings }
}

export function sanitizeGeneratedCss(value: string): string {
  if (value.length > GENERATED_CSS_LIMIT) throw new Error('生成的样式超过 150KB 限制。')

  let syntaxTree
  try {
    syntaxTree = parse(value, { context: 'stylesheet' })
  } catch {
    throw new Error('生成的 CSS 无法解析。')
  }

  walk(syntaxTree, (node) => {
    if (node.type === 'Url') throw new Error('生成的 CSS 不允许加载外部资源。')
    if (node.type === 'Atrule' && BLOCKED_AT_RULES.has(node.name.toLowerCase())) {
      throw new Error(`生成的 CSS 不允许使用 @${node.name}。`)
    }
    if (node.type === 'Function' && BLOCKED_FUNCTIONS.has(node.name.toLowerCase())) {
      throw new Error(`生成的 CSS 不允许使用 ${node.name}()。`)
    }
    if (node.type === 'Declaration' && ['behavior', '-moz-binding', 'src'].includes(node.property.toLowerCase())) {
      throw new Error(`生成的 CSS 不允许设置 ${node.property}。`)
    }
  })

  return generate(syntaxTree)
}

function sanitizeEffects(effects: GeneratedEffect[], ids: Set<string>): { effects: GeneratedEffect[]; warnings: string[] } {
  if (effects.length > GENERATED_EFFECT_LIMIT) throw new Error('生成的动效数量超过 32 个限制。')

  const warnings: string[] = []
  const validEffects: GeneratedEffect[] = []
  const seen = new Set<string>()
  const typeCounts = new Map<GeneratedEffectType, number>()

  for (const effect of effects) {
    const targetId = normalizeIdentifier(effect.targetId)
    const key = `${targetId}:${effect.type}`
    if (!targetId || !ids.has(targetId) || !EFFECT_TYPES.has(effect.type) || seen.has(key)) {
      warnings.push('已忽略无法匹配页面元素的动效。')
      continue
    }
    const currentCount = typeCounts.get(effect.type) ?? 0
    const typeLimit = EFFECT_TYPE_LIMITS[effect.type]
    if (typeLimit && currentCount >= typeLimit) {
      warnings.push(`已忽略超出数量限制的 ${effect.type} 动效。`)
      continue
    }
    seen.add(key)
    typeCounts.set(effect.type, currentCount + 1)
    validEffects.push({
      targetId,
      type: effect.type,
      intensity: typeof effect.intensity === 'number' ? Math.min(1, Math.max(0, effect.intensity)) : undefined
    })
  }

  return { effects: validEffects, warnings }
}

export function sanitizeGeneratedDesign(candidate: GeneratedPageDesign): SanitizedGeneratedDesign {
  if (candidate.version !== 1 || !Array.isArray(candidate.effects)) throw new Error('生成结果版本无效。')
  const body = sanitizeBodyHtml(candidate.bodyHtml)
  const effects = sanitizeEffects(candidate.effects, body.ids)
  return {
    design: {
      version: 1,
      bodyHtml: body.html,
      css: sanitizeGeneratedCss(candidate.css),
      effects: effects.effects,
      createdAt: Number.isNaN(Date.parse(candidate.createdAt)) ? new Date().toISOString() : candidate.createdAt
    },
    warnings: [...body.warnings, ...effects.warnings]
  }
}

function createTextSlot(value: string, className: string): Text | HTMLSpanElement {
  if (!value) {
    const empty = document.createElement('span')
    empty.className = className
    empty.textContent = '待补充'
    return empty
  }
  return document.createTextNode(value)
}

function appendProject(container: Element, project: Project) {
  const article = document.createElement('article')
  article.className = 'pf-project'

  const media = document.createElement('div')
  media.className = 'pf-project-media'
  if (project.image?.startsWith('data:image/')) {
    const image = document.createElement('img')
    image.src = project.image
    image.alt = '项目封面'
    media.append(image)
  } else {
    const index = document.createElement('span')
    index.textContent = String(container.children.length + 1).padStart(2, '0')
    media.append(index)
  }

  const body = document.createElement('div')
  body.className = 'pf-project-body'
  const title = document.createElement('h3')
  const href = safeExternalUrl(project.url)
  if (href) {
    const link = document.createElement('a')
    link.href = href
    link.target = '_blank'
    link.rel = 'noreferrer'
    link.textContent = project.title || '未命名项目'
    title.append(link)
  } else {
    title.textContent = project.title || '未命名项目'
  }
  const description = document.createElement('p')
  description.textContent = project.description
  const tags = document.createElement('ul')
  tags.className = 'pf-tags'
  for (const value of project.tags.filter(Boolean)) {
    const tag = document.createElement('li')
    tag.textContent = value
    tags.append(tag)
  }
  body.append(title, description, tags)
  article.append(media, body)
  container.append(article)
}

function fillSlot(element: Element, slot: string, data: PortfolioData) {
  element.replaceChildren()
  element.classList.add(`pf-slot-${slot}`)

  if (slot === 'name' || slot === 'headline' || slot === 'bio') {
    element.append(createTextSlot(data[slot], 'pf-empty'))
    return
  }

  if (slot === 'avatar') {
    if (data.avatar?.startsWith('data:image/')) {
      const image = document.createElement('img')
      image.src = data.avatar
      image.alt = `${data.name || '个人'}头像`
      element.append(image)
    } else {
      const fallback = document.createElement('span')
      fallback.textContent = data.name.trim().slice(0, 1) || '我'
      fallback.className = 'pf-avatar-fallback'
      element.append(fallback)
    }
    return
  }

  if (slot === 'skills') {
    const list = document.createElement('ul')
    list.className = 'pf-skills'
    for (const value of data.skills.filter(Boolean)) {
      const item = document.createElement('li')
      item.textContent = value
      list.append(item)
    }
    element.append(list)
    return
  }

  if (slot === 'projects') {
    element.classList.add('pf-projects')
    for (const project of data.projects) appendProject(element, project)
    return
  }

  if (slot === 'contact') {
    element.classList.add('pf-contact-links')
    if (data.email.trim()) {
      const email = document.createElement('a')
      email.href = `mailto:${data.email.trim()}`
      email.textContent = data.email.trim()
      element.append(email)
    }
    if (data.location.trim()) {
      const location = document.createElement('span')
      location.textContent = data.location.trim()
      element.append(location)
    }
    for (const social of data.socials) {
      const href = safeExternalUrl(social.url)
      if (!href || !social.label.trim()) continue
      const link = document.createElement('a')
      link.href = href
      link.target = '_blank'
      link.rel = 'noreferrer'
      link.textContent = social.label.trim()
      element.append(link)
    }
  }
}

export function renderGeneratedBody(data: PortfolioData, design: GeneratedPageDesign): SanitizedGeneratedDesign & { body: string } {
  const sanitized = sanitizeGeneratedDesign(design)
  const template = document.createElement('template')
  template.innerHTML = sanitized.design.bodyHtml

  for (const element of Array.from(template.content.querySelectorAll('[data-slot]'))) {
    fillSlot(element, element.getAttribute('data-slot') ?? '', data)
  }

  for (const effect of sanitized.design.effects) {
    const target = template.content.querySelector(`#${effect.targetId}`)
    if (!target) continue
    const current = target.getAttribute('data-pf-effect')?.split(' ').filter(Boolean) ?? []
    target.setAttribute('data-pf-effect', [...current, effect.type].join(' '))
    if (typeof effect.intensity === 'number') target.setAttribute('data-pf-intensity', effect.intensity.toFixed(2))
  }

  return { ...sanitized, body: template.innerHTML }
}

export const generatedRuntimeStyles = `
  html[data-preview="true"] { min-width: 0 !important; }
  html[data-preview="true"] body { zoom: .78; }
  [data-pf-effect~="reveal"], [data-pf-effect~="media-swap"]:not(.pf-sequence-ready) { opacity: 0; transform: translateY(34px); transition: opacity .75s ease, transform .75s ease; }
  [data-pf-effect~="reveal"].pf-visible, [data-pf-effect~="media-swap"].pf-visible { opacity: 1; transform: translateY(0); }
  [data-pf-effect~="parallax"] { transform: translate3d(0, var(--pf-parallax-y, 0), 0); will-change: transform; }
  [data-pf-effect~="sticky"] { position: sticky; top: 0; }
  [data-pf-effect~="section-snap"] { scroll-snap-align: start; scroll-snap-stop: always; }
  [data-pf-effect~="marquee"] { overflow: hidden; }
  [data-pf-effect~="marquee"] > * { width: max-content; animation: pf-marquee 18s linear infinite; }
  [data-pf-effect~="particle-field"] { position: relative; isolation: isolate; }
  [data-pf-effect~="particle-field"] > :not(.pf-particle-canvas) { position: relative; z-index: 1; }
  .pf-particle-canvas { position: absolute; z-index: 0; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .pf-scroll-scene { min-height: calc(var(--pf-scene-length, 3) * 100vh) !important; padding-block: 0 !important; overflow: visible !important; }
  .pf-scroll-pin { position: sticky !important; top: 0 !important; height: 100vh !important; min-height: 100vh !important; overflow: hidden !important; }
  [data-pf-effect~="scene-pin"].pf-sequence-ready > .pf-scene-step { position: absolute !important; inset: 0 !important; margin: 0 !important; opacity: 0; pointer-events: none; will-change: opacity, transform; }
  .pf-media-stage { position: absolute !important; inset: clamp(150px, 21vh, 210px) 0 5vh !important; margin: 0 !important; }
  .pf-media-sequence .pf-project { position: absolute !important; inset: 0 6vw !important; display: grid !important; grid-template-columns: minmax(0, 1.3fr) minmax(280px, .7fr) !important; gap: clamp(34px, 5vw, 76px) !important; align-items: center !important; margin: 0 !important; padding: 0 !important; border: 0 !important; opacity: 0; pointer-events: none; will-change: opacity, transform; }
  .pf-media-sequence .pf-project-media { min-height: 0; max-height: 64vh; }
  .pf-sequence-progress { position: absolute; z-index: 4; right: 32px; bottom: 24px; display: grid; grid-template-columns: auto 86px auto; gap: 9px; align-items: center; color: inherit; font: 600 10px/1 ui-monospace, monospace; opacity: .68; pointer-events: none; }
  .pf-sequence-progress i { position: relative; width: 86px; height: 1px; overflow: hidden; background: currentColor; opacity: .3; }
  .pf-sequence-progress i::after { position: absolute; inset: 0; content: ""; background: var(--accent); transform: scaleX(var(--pf-sequence-progress, 0)); transform-origin: left; }
  @keyframes pf-marquee { to { transform: translateX(-35%); } }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto !important; }
    *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
    [data-pf-effect] { opacity: 1 !important; transform: none !important; }
    .pf-scroll-scene { min-height: auto !important; padding-block: 0 !important; }
    .pf-scroll-pin { position: relative !important; height: auto !important; min-height: 100vh !important; overflow: visible !important; }
    [data-pf-effect~="scene-pin"] > .pf-scene-step, .pf-media-sequence .pf-project { position: relative !important; inset: auto !important; min-height: 100vh; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }
    .pf-media-stage { position: relative !important; inset: auto !important; }
    .pf-sequence-progress { display: none !important; }
    .pf-particle-canvas { opacity: .32; }
  }`

export const generatedRuntimeScript = `(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const scenes = [];

  const sceneItems = (root, type) => type === 'media'
    ? Array.from(root.querySelectorAll('.pf-project'))
    : Array.from(root.children).filter((node) => node.classList.contains('pf-scene-step'));

  const setupScene = (sourceRoot, type) => {
    let root = sourceRoot;
    let host = root.closest('section') || root.parentElement;
    if (!host) return false;
    let items = sceneItems(root, type);
    if (items.length < 2) return false;

    if (host === root) {
      const pin = document.createElement('div');
      pin.className = root.className;
      pin.setAttribute('data-pf-effect', root.getAttribute('data-pf-effect') || '');
      if (root.dataset.pfIntensity) pin.dataset.pfIntensity = root.dataset.pfIntensity;
      while (root.firstChild) pin.append(root.firstChild);
      root.append(pin);
      root = pin;
      items = sceneItems(root, type);
    }

    const intensity = clamp(Number(root.dataset.pfIntensity || .65));
    const dwell = .72 + intensity * .72;
    const length = Math.max(2.6, 1 + items.length * dwell);
    host.classList.add('pf-scroll-scene');
    host.style.setProperty('--pf-scene-length', length.toFixed(2));
    root.classList.add('pf-scroll-pin', 'pf-sequence-ready');

    if (type === 'media') {
      root.classList.add('pf-media-sequence');
      const stage = root.matches('.pf-projects') ? root : root.querySelector('.pf-projects');
      if (stage && stage !== root) stage.classList.add('pf-media-stage');
    }

    items.forEach((item) => item.classList.add('pf-scene-step'));
    const progress = document.createElement('div');
    progress.className = 'pf-sequence-progress';
    progress.setAttribute('aria-hidden', 'true');
    progress.innerHTML = '<span>01</span><i></i><span>/ ' + String(items.length).padStart(2, '0') + '</span>';
    root.append(progress);
    scenes.push({ host, root, items, progress, current: -1 });
    return true;
  };

  if (!reduced) {
    document.querySelectorAll('[data-pf-effect~="scene-pin"]').forEach((root) => setupScene(root, 'scene'));
    document.querySelectorAll('[data-pf-effect~="media-swap"]').forEach((root) => setupScene(root, 'media'));
  }

  const observed = document.querySelectorAll('[data-pf-effect~="reveal"], [data-pf-effect~="media-swap"]:not(.pf-sequence-ready)');
  if (reduced || !('IntersectionObserver' in window)) observed.forEach((node) => node.classList.add('pf-visible'));
  else {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add('pf-visible');
    }), { threshold: .18 });
    observed.forEach((node) => observer.observe(node));
  }
  const parallax = reduced ? [] : Array.from(document.querySelectorAll('[data-pf-effect~="parallax"]'));
  let scheduled = false;
  const updateMotion = () => {
    scheduled = false;
    parallax.forEach((node) => {
      const rect = node.getBoundingClientRect();
      const intensity = Number(node.dataset.pfIntensity || .35);
      node.style.setProperty('--pf-parallax-y', ((innerHeight / 2 - rect.top) * intensity * .16).toFixed(1) + 'px');
    });
    scenes.forEach((scene) => {
      const rect = scene.host.getBoundingClientRect();
      const travel = Math.max(1, rect.height - innerHeight);
      const progress = clamp(-rect.top / travel);
      const frame = progress * (scene.items.length - 1);
      const active = Math.round(frame);
      scene.items.forEach((item, index) => {
        const distance = index - frame;
        const visibility = clamp(1 - Math.abs(distance));
        const eased = visibility * visibility * (3 - 2 * visibility);
        item.style.opacity = eased.toFixed(3);
        item.style.transform = 'translate3d(0,' + (distance * 54).toFixed(1) + 'px,0) scale(' + (.94 + eased * .06).toFixed(3) + ')';
        item.style.zIndex = String(20 - Math.round(Math.abs(distance) * 2));
        item.style.pointerEvents = index === active ? 'auto' : 'none';
        item.setAttribute('aria-hidden', index === active ? 'false' : 'true');
        item.classList.toggle('pf-active', index === active);
      });
      if (active !== scene.current) {
        scene.current = active;
        scene.root.dataset.pfSequenceCurrent = String(active + 1);
        const label = scene.progress.querySelector('span');
        if (label) label.textContent = String(active + 1).padStart(2, '0');
      }
      scene.progress.style.setProperty('--pf-sequence-progress', ((active + 1) / scene.items.length).toFixed(3));
    });
  };
  const scheduleMotion = () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(updateMotion);
    }
  };
  if (parallax.length || scenes.length) {
    addEventListener('scroll', scheduleMotion, { passive: true });
    addEventListener('resize', scheduleMotion, { passive: true });
    updateMotion();
  }

  const hashSeed = (value) => {
    let seed = 2166136261;
    for (let index = 0; index < value.length; index += 1) seed = Math.imul(seed ^ value.charCodeAt(index), 16777619);
    return seed >>> 0;
  };
  const seededRandom = (initial) => {
    let seed = initial || 1;
    return () => {
      seed += 0x6D2B79F5;
      let value = seed;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  };
  const setupParticles = (root) => {
    const canvas = document.createElement('canvas');
    canvas.className = 'pf-particle-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    root.prepend(canvas);
    const context = canvas.getContext('2d');
    if (!context) return;
    const random = seededRandom(hashSeed(root.id || 'particle-field'));
    const intensity = clamp(Number(root.dataset.pfIntensity || .7));
    const count = Math.round(54 + intensity * 58);
    const particles = Array.from({ length: count }, () => {
      const angle = random() * Math.PI * 2;
      const radius = Math.pow(random(), .56);
      return {
        x: .5 + Math.cos(angle) * radius * .43,
        y: .5 + Math.sin(angle * 2) * radius * .22 + Math.sin(angle) * .09,
        size: .7 + random() * 2.4,
        phase: random() * Math.PI * 2,
        drift: .35 + random() * .85
      };
    });
    let width = 0;
    let height = 0;
    let pointerX = .5;
    let pointerY = .5;
    let visible = true;
    const resize = () => {
      const rect = root.getBoundingClientRect();
      const ratio = Math.min(1.5, devicePixelRatio || 1);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    root.addEventListener('pointermove', (event) => {
      const rect = root.getBoundingClientRect();
      pointerX = clamp((event.clientX - rect.left) / Math.max(1, rect.width));
      pointerY = clamp((event.clientY - rect.top) / Math.max(1, rect.height));
    }, { passive: true });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => { visible = entries[0] ? entries[0].isIntersecting : true; }, { rootMargin: '120px' }).observe(root);
    }
    const accent = getComputedStyle(root).getPropertyValue('--accent').trim() || '#62f28d';
    const draw = (time = 0) => {
      if (!visible) {
        if (!reduced) requestAnimationFrame(draw);
        return;
      }
      context.clearRect(0, 0, width, height);
      const points = particles.map((particle) => {
        const wave = time * .00012 * particle.drift + particle.phase;
        const pullX = (pointerX - .5) * 16 * intensity;
        const pullY = (pointerY - .5) * 10 * intensity;
        return {
          x: particle.x * width + Math.cos(wave) * 13 + pullX,
          y: particle.y * height + Math.sin(wave * 1.3) * 9 + pullY,
          size: particle.size
        };
      });
      context.strokeStyle = accent;
      context.lineWidth = .65;
      points.forEach((point, index) => {
        for (let offset = 1; offset <= 2; offset += 1) {
          const other = points[(index + offset) % points.length];
          const distance = Math.hypot(point.x - other.x, point.y - other.y);
          if (distance > 150) continue;
          context.globalAlpha = (1 - distance / 150) * .16 * intensity;
          context.beginPath();
          context.moveTo(point.x, point.y);
          context.lineTo(other.x, other.y);
          context.stroke();
        }
      });
      context.fillStyle = accent;
      context.shadowColor = accent;
      context.shadowBlur = 13;
      points.forEach((point, index) => {
        context.globalAlpha = .26 + ((index % 7) / 7) * .68;
        context.beginPath();
        context.arc(point.x, point.y, point.size, 0, Math.PI * 2);
        context.fill();
      });
      context.globalAlpha = 1;
      context.shadowBlur = 0;
      if (!reduced) requestAnimationFrame(draw);
    };
    resize();
    addEventListener('resize', resize, { passive: true });
    draw();
  };
  Array.from(document.querySelectorAll('[data-pf-effect~="particle-field"]')).slice(0, 2).forEach(setupParticles);
  if (document.querySelector('[data-pf-effect~="section-snap"]')) document.documentElement.classList.add('pf-snap');
})();`

export function createImmersiveGeneratedDesign(): GeneratedPageDesign {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    bodyHtml: `<header id="pf-nav" class="pf-nav"><div class="pf-brand" data-slot="name"></div><span>IMMERSIVE ARCHIVE / 2026</span></header>
<main>
  <section id="pf-hero" class="pf-act pf-hero">
    <div id="pf-hero-copy" class="pf-hero-copy"><p class="pf-kicker">PERSONAL ARCHIVE — IDEAS · SYSTEMS · EXPERIENCES</p><div class="pf-person" data-slot="name"></div><h1 data-slot="headline"></h1><p class="pf-bio" data-slot="bio"></p></div>
    <div id="pf-portrait" class="pf-portrait" data-slot="avatar"></div><span class="pf-act-index">01 / 05</span>
  </section>
  <section id="pf-manifesto" class="pf-act pf-manifesto"><div id="pf-manifesto-sequence" class="pf-manifesto-sequence">
    <article class="pf-scene-step"><p class="pf-kicker">ACT 02 — A POINT OF VIEW</p><h2>好的作品，先让复杂的事变得可以理解。</h2><span class="pf-scene-code">01 · CLARITY</span></article>
    <article class="pf-scene-step"><p class="pf-kicker">FROM SIGNAL TO SYSTEM</p><h2>再把理解，变成能够被真实使用的秩序。</h2><span class="pf-scene-code">02 · STRUCTURE</span></article>
    <article class="pf-scene-step pf-scene-warm"><p class="pf-kicker">THE HUMAN LAYER</p><h2>最后留下的，不是功能，而是被认真对待的感受。</h2><span class="pf-scene-code">03 · CARE</span></article>
  </div><span class="pf-act-index">02 / 05</span></section>
  <section id="pf-skills" class="pf-act pf-skills-act"><div><p class="pf-kicker">CAPABILITIES — HOW I WORK</p><h2>方法不是标签，是反复打磨后的判断。</h2></div><div id="pf-skills-strip" class="pf-skills-strip" data-slot="skills"></div><span class="pf-act-index">03 / 05</span></section>
  <section id="pf-work" class="pf-act pf-work"><div id="pf-work-sequence" class="pf-work-sequence"><div class="pf-work-heading"><p class="pf-kicker">SELECTED PROJECTS — SCROLL TO EXPLORE</p><h2>正在发生的作品</h2></div><div id="pf-project-list" data-slot="projects"></div></div><span class="pf-act-index">04 / 05</span></section>
  <section id="pf-contact" class="pf-act pf-contact"><p class="pf-kicker">NEXT CHAPTER</p><h2>让下一件值得做的事，从一次联系开始。</h2><div data-slot="contact"></div><span class="pf-act-index">05 / 05</span></section>
</main>`,
    css: `:root{--night:#050806;--paper:#edf4ef;--muted:#91a198;--line:rgba(237,244,239,.16);--warm:#f0b94d}*{box-sizing:border-box}html{min-width:980px;background:var(--night);color:var(--paper);scroll-behavior:smooth}body{margin:0;min-width:980px;background:var(--night);font-family:Inter,"Noto Sans SC","PingFang SC",system-ui,sans-serif}.pf-nav{position:fixed;z-index:30;top:0;left:0;width:100%;height:68px;display:flex;align-items:center;justify-content:space-between;padding:0 42px;border-bottom:1px solid rgba(237,244,239,.08);background:rgba(5,8,6,.9);font:600 11px/1.2 ui-monospace,monospace;letter-spacing:0}.pf-brand{color:var(--accent);font-size:13px}.pf-act{position:relative;min-height:100vh;padding:96px 6vw 62px;border-bottom:1px solid var(--line);overflow:hidden}.pf-kicker{margin:0 0 22px;color:var(--accent);font:600 11px/1.5 ui-monospace,monospace;letter-spacing:0}.pf-act-index{position:absolute;z-index:8;right:32px;bottom:26px;color:var(--muted);font:500 11px/1 ui-monospace,monospace}.pf-hero{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(270px,.45fr);align-items:center;gap:5vw;background:#050806}.pf-hero::after{position:absolute;z-index:0;inset:68px 0 auto 0;height:1px;content:"";background:rgba(237,244,239,.08)}.pf-hero-copy{position:relative;z-index:2}.pf-person{margin-bottom:12px;color:var(--muted);font:600 14px/1.2 ui-monospace,monospace;letter-spacing:0}.pf-hero h1{max-width:860px;margin:0;font-size:82px;line-height:.98;letter-spacing:0}.pf-bio{max-width:680px;margin:28px 0 0;color:#b8c4bd;font-size:17px;line-height:1.7}.pf-portrait{position:relative;z-index:2;aspect-ratio:3/4;overflow:hidden;border:1px solid rgba(237,244,239,.24);background:#101713}.pf-portrait img{width:100%;height:100%;object-fit:cover;filter:saturate(.72) contrast(1.08)}.pf-avatar-fallback{width:100%;height:100%;display:grid;place-items:center;color:var(--accent);font-size:104px;font-weight:800}.pf-manifesto{padding:0;background:#080d0a}.pf-manifesto-sequence{background:#080d0a}.pf-scene-step{display:grid;align-content:center;justify-items:center;padding:12vh 10vw;text-align:center}.pf-scene-step h2{max-width:1020px;margin:0;font-size:76px;line-height:1.08;letter-spacing:0}.pf-scene-step::before{position:absolute;inset:12vh 8vw;content:"";border:1px solid rgba(237,244,239,.1)}.pf-scene-code{position:absolute;right:9vw;bottom:14vh;color:var(--muted);font:600 11px/1 ui-monospace,monospace}.pf-scene-warm .pf-kicker,.pf-scene-warm h2{color:var(--warm)}.pf-skills-act{display:grid;grid-template-rows:1fr auto;align-content:space-between;background:#0b110d}.pf-skills-act h2,.pf-work h2,.pf-contact h2{max-width:1080px;margin:0;font-size:70px;line-height:1.03;letter-spacing:0}.pf-skills-strip{margin-inline:-6vw;padding-block:25px;border-block:1px solid var(--line)}.pf-skills{display:flex;gap:22px;margin:0;padding:0 6vw;list-style:none}.pf-skills li{font-size:42px;font-weight:750;white-space:nowrap}.pf-skills li::after{padding-left:22px;color:var(--accent);content:"✦"}.pf-work{padding:0;background:#07100b}.pf-work-sequence{background:#07100b}.pf-work-heading{position:relative;z-index:4;display:flex;align-items:end;justify-content:space-between;padding:96px 6vw 0}.pf-projects{display:grid;gap:0}.pf-project{display:grid;grid-template-columns:minmax(260px,.8fr) minmax(0,1.2fr);gap:54px;align-items:center;padding:46px 0;border-top:1px solid var(--line)}.pf-project-media{aspect-ratio:16/10;display:grid;place-items:center;overflow:hidden;border:1px solid rgba(237,244,239,.12);background:#101713;color:var(--accent);font:700 76px/1 ui-monospace,monospace}.pf-project-media img{width:100%;height:100%;object-fit:cover}.pf-project-body h3{margin:0 0 16px;font-size:48px;line-height:1.08}.pf-project-body h3 a{color:inherit;text-decoration:none}.pf-project-body p{max-width:650px;margin:0 0 22px;color:#acbab2;font-size:17px;line-height:1.7}.pf-tags{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}.pf-tags li{padding:7px 10px;border:1px solid var(--line);color:var(--muted);font:600 11px/1 ui-monospace,monospace}.pf-contact{display:flex;min-height:100vh;flex-direction:column;justify-content:center;color:#111713;background:#e9efeb}.pf-contact .pf-kicker,.pf-contact-links a{color:#177453}.pf-contact h2{max-width:1080px;font-size:88px}.pf-contact-links{display:flex;flex-wrap:wrap;gap:12px 30px;margin-top:48px;color:#52625a;font:600 14px/1.4 ui-monospace,monospace}.pf-contact-links a{text-underline-offset:6px}.pf-contact .pf-act-index{color:#65736c}.pf-empty{color:var(--muted)}`,
    effects: [
      { targetId: 'pf-hero', type: 'particle-field', intensity: .86 },
      { targetId: 'pf-hero-copy', type: 'reveal' },
      { targetId: 'pf-portrait', type: 'parallax', intensity: .45 },
      { targetId: 'pf-manifesto-sequence', type: 'scene-pin', intensity: .78 },
      { targetId: 'pf-skills-strip', type: 'marquee' },
      { targetId: 'pf-work-sequence', type: 'media-swap', intensity: .88 },
      { targetId: 'pf-contact', type: 'reveal' }
    ]
  }
}
