export type Locale = "en" | "id";

const messages = {
  en: {
    title: "Hello World",
    subtitle: "Agentic project template is live.",
    health: "API health",
    loading: "Loading…",
    offline: "Offline — showing local state.",
    localeLabel: "Language",
    schema: "Schema",
    env: "Environment",
    fetchedAt: "Fetched",
  },
  id: {
    title: "Halo Dunia",
    subtitle: "Template proyek agentik sudah hidup.",
    health: "Kesehatan API",
    loading: "Memuat…",
    offline: "Luring — menampilkan status lokal.",
    localeLabel: "Bahasa",
    schema: "Skema",
    env: "Lingkungan",
    fetchedAt: "Diambil",
  },
} as const;

export type MessageKey = keyof (typeof messages)["en"];

export function t(locale: Locale, key: MessageKey): string {
  return messages[locale][key];
}

export function formatWhen(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
