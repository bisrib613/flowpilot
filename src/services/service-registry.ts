// Central service catalog used by desktop UI and future agent/tool adapters.
// Service IDs are persisted account identifiers, not display names.
export type ServiceDefinition = {
  name: string
  shortName: string
  logo: string
  url: string
  category: "creative" | "social"
  // Manual bulk profile creation must never imply automatic sign-in.
  sharedSignIn: "assisted-google" | "manual"
}

export const SERVICES = {
  flow: { name: "Google Flow", shortName: "Flow", logo: "/flow-logo.png", url: "https://flow.google.com/", category: "creative", sharedSignIn: "manual" },
  dola: { name: "Dola", shortName: "Dola", logo: "/dola-logo.png", url: "https://www.dola.com/", category: "creative", sharedSignIn: "assisted-google" },
  leonardo: { name: "Leonardo AI", shortName: "Leonardo", logo: "/leonardo-logo.png", url: "https://app.leonardo.ai/", category: "creative", sharedSignIn: "assisted-google" },
  chatgpt: { name: "ChatGPT", shortName: "ChatGPT", logo: "/chatgpt-logo.png", url: "https://chatgpt.com/", category: "creative", sharedSignIn: "assisted-google" },
  migoo: { name: "Migoo", shortName: "Migoo", logo: "/migoo-logo.png", url: "https://migoo.ai/home", category: "creative", sharedSignIn: "assisted-google" },
  gemini: { name: "Gemini", shortName: "Gemini", logo: "/gemini.webp", url: "https://gemini.google.com/app", category: "creative", sharedSignIn: "manual" },
  suno: { name: "Suno", shortName: "Suno", logo: "/suno.jpg", url: "https://suno.com/", category: "creative", sharedSignIn: "manual" },
  claude: { name: "Claude", shortName: "Claude", logo: "/claude-logo.svg", url: "https://claude.ai/", category: "creative", sharedSignIn: "assisted-google" },
  pinterest: { name: "Pinterest", shortName: "Pinterest", logo: "/pinterest-logo.svg", url: "https://www.pinterest.com/", category: "social", sharedSignIn: "manual" },
  threads: { name: "Threads", shortName: "Threads", logo: "/threads-logo.svg", url: "https://www.threads.com/", category: "social", sharedSignIn: "manual" },
} as const satisfies Record<string, ServiceDefinition>

export type ServiceId = keyof typeof SERVICES
export const SERVICE_IDS = Object.keys(SERVICES) as ServiceId[]

export function isServiceId(value: unknown): value is ServiceId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SERVICES, value)
}

export function requiresManualSharedSignIn(service: ServiceId): boolean {
  return SERVICES[service].sharedSignIn === "manual"
}
