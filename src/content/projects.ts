import type { Project } from './types';

/**
 * Real projects, in display order. Empty until final copy is supplied.
 * Copy the shape below; omit any optional field you can't state accurately.
 *
 * {
 *   slug: 'short-url-name',
 *   title: 'Project title',
 *   summary: 'One line.',
 *   technologies: ['Python', 'PyTorch'],
 *   problem: '…',
 *   approach: '…',
 *   contributions: ['…', '…'],
 *   results: '…',        // optional — verified outcomes only
 *   limitations: '…',    // optional
 *   githubUrl: 'https://github.com/…',  // optional
 *   demoUrl: 'https://…',               // optional
 *   draft: false,
 * }
 */
export const projects: Project[] = [];
