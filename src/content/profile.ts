import type { Profile } from './types';

/**
 * Real identity content. Name and role are confirmed.
 * Replace `intro` and add `contactLinks` when ready — see CONTENT_GUIDE.md.
 */
export const profile: Profile = {
  name: 'Kenichi Shawn Tanzil',
  role: 'AI / Machine Learning Engineer',
  intro: '',
  contactLinks: [
    { label: 'github', href: 'https://github.com/kenichist' },
    // { label: 'email', href: 'mailto:you@example.com' },
    // { label: 'linkedin', href: 'https://www.linkedin.com/in/your-handle/' },
  ],
};
