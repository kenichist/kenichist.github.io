import type { Note } from './types';

/**
 * Real notes / research entries. Empty until final copy is supplied.
 * Sorted newest first by `date` when displayed.
 *
 * {
 *   slug: 'short-url-name',
 *   title: 'Note title',
 *   summary: 'One line.',
 *   date: '2026-11-05',
 *   body: `First paragraph.
 *
 * Second paragraph.`,
 *   draft: false,
 * }
 */
export const notes: Note[] = [];
