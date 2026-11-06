/** Content model. Components read these shapes only, so real copy can replace fixtures without redesign. */

export interface ContactLink {
  /** Visible text, e.g. "email", "github", "linkedin". */
  label: string;
  /** https://… or mailto:… — anything else is dropped at build time. */
  href: string;
}

export interface Profile {
  name: string;
  role: string;
  /** One or two sentences. Empty → the hero shows no intro line. */
  intro: string;
  contactLinks: ContactLink[];
}

export interface Project {
  /** URL segment: lowercase letters, digits and hyphens. */
  slug: string;
  title: string;
  /** One line. Used as the overview on the detail page and on the /work/ index. */
  summary?: string;
  technologies?: string[];
  problem?: string;
  approach?: string;
  contributions?: string[];
  /** Optional. Only state results that can be verified. Omitted when empty. */
  results?: string;
  /** Optional. Omitted when empty. */
  limitations?: string;
  githubUrl?: string;
  demoUrl?: string;
  /** Any other links (e.g. downloads). Only https/http URLs are kept. */
  links?: ContactLink[];
  /** Drafts never generate routes, list entries, or sitemap entries. */
  draft?: boolean;
}

export interface Note {
  slug: string;
  title: string;
  summary?: string;
  /** Paragraphs separated by a blank line. */
  body: string;
  /** ISO date, YYYY-MM-DD. */
  date?: string;
  technologies?: string[];
  /** e.g. the code repository. Only https/http URLs are kept. */
  links?: ContactLink[];
  draft?: boolean;
}
