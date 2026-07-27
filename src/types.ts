export type SocialLink = {
  id: string
  label: string
  url: string
}

export type Project = {
  id: string
  title: string
  description: string
  tags: string[]
  image?: string
  url: string
}

export type PortfolioData = {
  name: string
  headline: string
  bio: string
  avatar?: string
  email: string
  location: string
  skills: string[]
  projects: Project[]
  socials: SocialLink[]
  accentColor: string
}
