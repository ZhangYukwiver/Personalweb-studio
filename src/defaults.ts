import type { PortfolioData } from './types'

export const STORAGE_KEY = 'portfolio-forge-draft-v1'

export const defaultPortfolio: PortfolioData = {
  name: '林予安',
  headline: '产品设计师，专注于清晰而有温度的数字体验。',
  bio: '我通过研究、策略和细节打磨，把复杂的问题整理成容易使用的产品。现在居住在上海，也乐于与好奇的人一起做有价值的事。',
  email: 'hello@example.com',
  location: '中国，上海',
  skills: ['产品策略', '交互设计', '设计系统', '用户研究'],
  projects: [
    {
      id: 'project-1',
      title: '潮汐笔记',
      description: '帮助创作者整理灵感、建立个人知识流的移动端笔记工具。',
      tags: ['移动应用', '产品设计'],
      url: ''
    },
    {
      id: 'project-2',
      title: '远方工作台',
      description: '为分布式团队设计的轻量协作空间，让信息和进度更容易被看见。',
      tags: ['Web 应用', '设计系统'],
      url: ''
    }
  ],
  socials: [
    { id: 'social-1', label: 'LinkedIn', url: '' },
    { id: 'social-2', label: 'Behance', url: '' }
  ],
  accentColor: '#0f766e'
}

export function createDefaultPortfolio(): PortfolioData {
  return JSON.parse(JSON.stringify(defaultPortfolio)) as PortfolioData
}
