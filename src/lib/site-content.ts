import { demoIntro, demoNotes, demoProjects } from '../content/fixtures';
import { notes } from '../content/notes';
import { profile } from '../content/profile';
import { projects } from '../content/projects';
import { site } from '../content/site';
import { resolveContent } from './content';

/** The single resolved content object every page reads. */
export const content = resolveContent({
  demo: site.demoContent,
  profile,
  projects,
  notes,
  fixtures: { intro: demoIntro, projects: demoProjects, notes: demoNotes },
});
