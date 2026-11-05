import type { Note, Project } from './types';

/**
 * Demo fixtures — illustrative only. Shown when site.demoContent is true.
 * None of this is a factual claim; replace via projects.ts / notes.ts.
 */

const P = 'Placeholder.';

export const demoIntro =
  'Placeholder introduction. One or two sentences about the kind of systems you build and the problems you care about.';

export const demoProjects: Project[] = [
  {
    slug: 'project-01',
    title: 'Project title 01',
    summary: 'Placeholder overview. One line on what this project is and why it mattered.',
    technologies: ['Technology A', 'Technology B', 'Technology C'],
    problem: `${P} Describe the problem: who needed this, what made it hard, and which constraints shaped the work.`,
    approach: `${P} Explain the approach and the key decisions, including alternatives that were considered and set aside.`,
    contributions: [
      `${P} A specific piece of technical work you owned.`,
      `${P} A second contribution — a component, an evaluation, an infrastructure change.`,
      `${P} A third, if it adds something the first two don't.`,
    ],
    results: `${P} Outcomes go here only when they can be stated accurately and verified.`,
    limitations: `${P} What didn't work, what remains open, and where the approach stops applying.`,
  },
  {
    slug: 'project-02',
    title: 'Project title 02',
    summary: 'Placeholder overview. This fixture has no results, limitations, or technology list, so those sections are omitted.',
    problem: `${P} Problem statement.`,
    approach: `${P} Approach.`,
    contributions: [`${P} Contribution.`],
  },
  {
    slug: 'project-03',
    title: 'Project title 03 with a deliberately long placeholder name to test wrapping on narrow screens',
    summary: 'Placeholder overview for the long-title fixture.',
    technologies: ['Technology A'],
    problem: `${P} Problem statement.`,
    approach: `${P} Approach.`,
    contributions: [`${P} Contribution.`, `${P} Contribution.`],
    limitations: `${P} Limitations.`,
  },
  {
    slug: 'project-04',
    title: 'Project title 04',
    summary: 'Placeholder overview.',
    technologies: ['Technology B', 'Technology D'],
    problem: `${P} Problem statement.`,
    approach: `${P} Approach.`,
    contributions: [`${P} Contribution.`],
  },
  {
    slug: 'project-draft',
    title: 'Draft project (never published)',
    draft: true,
  },
];

export const demoNotes: Note[] = [
  {
    slug: 'research-note-01',
    title: 'Research note 01',
    summary: 'Placeholder summary for a note.',
    date: '2026-02-01',
    body: `${P} The opening paragraph of a note states the question and why it is worth writing down.

${P} Middle paragraphs work through the idea — an experiment, a reading, a design trade-off — at whatever length it needs. This paragraph is longer so the reading column can be judged with a realistic line count and rhythm across several lines of text.

${P} A closing paragraph says what changed in your thinking, or what you would try next.`,
  },
  {
    slug: 'research-note-02',
    title: 'Research note 02',
    summary: 'Placeholder summary for a second note.',
    date: '2026-01-10',
    body: `${P} A shorter note, to check that brief entries still read as intentional.`,
  },
  {
    slug: 'research-note-draft',
    title: 'Draft note (never published)',
    date: '2026-03-01',
    body: 'Draft.',
    draft: true,
  },
];
