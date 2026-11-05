# Content guide

The components only read data from `src/content/`. You never need to edit a component to add
real copy.

| What | File | Field |
| --- | --- | --- |
| Name, role | `src/content/profile.ts` | `name`, `role` (already real) |
| Hero introduction | `src/content/profile.ts` | `intro`: one or two sentences. Leave it empty and the line is omitted |
| Contact links | `src/content/profile.ts` | `contactLinks: [{ label, href }]`. Only `https://…` and `mailto:…` are accepted; anything else (`#`, blank, relative) is dropped |
| Projects | `src/content/projects.ts` | array of projects, in display order. The first four appear on the homepage |
| Notes | `src/content/notes.ts` | array of notes, shown newest first by `date` |
| Page title suffix, meta description | `src/content/site.ts` | `titleSuffix`, `description` |
| Public domain (sitemap, robots) | `src/content/site.ts` → `SITE_URL`, or the `SITE_URL` env var | e.g. `https://example.com` |

## Project fields

```ts
{
  slug: 'multilingual-spam',             // URL: /work/multilingual-spam/ (lowercase, digits, hyphens)
  title: 'Multilingual spam classification',
  summary: 'One line.',                  // overview on the detail page and the /work/ index
  technologies: ['Python', 'PyTorch'],   // optional; shown as one quiet line
  problem: '…',                          // optional sections are omitted when empty
  approach: '…',
  contributions: ['…', '…'],
  results: '…',                          // optional: verified outcomes only
  limitations: '…',                      // optional
  githubUrl: 'https://github.com/…',     // optional; shown only if it is a valid URL
  demoUrl: 'https://…',                  // optional
  draft: true,                           // drafts get no route, no list entry, no sitemap entry
}
```

## Note fields

```ts
{ slug: 'retrieval-notes', title: '…', summary: '…', date: '2026-11-05', body: `Paragraph one.

Paragraph two.` }
```

Separate paragraphs in `body` with a blank line.

## Demo mode

Demo mode is **on** right now, so the finished interface can be reviewed. While it is on:

- projects and notes come from `src/content/fixtures.ts`, not from your files;
- an empty `intro` is filled with a placeholder sentence;
- every page carries `noindex, nofollow`, `robots.txt` disallows crawling, and the sitemap is empty;
- one line at the top of each page says "demo preview · placeholder entries".

Contact links are **never** invented, even in demo mode. If you haven't added any, the footer says so.

**To turn demo mode off**, either:

- set `DEMO_DEFAULT = false` in `src/content/site.ts`, or
- build once with `DEMO_CONTENT=0 npm run build` (shortcut: `npm run build:live`).

With demo mode off and no content added, the site still builds. It shows intentional empty states
("Project write-ups are in progress.", "No notes published yet.") and generates no project or note
routes.

## Checklist before turning demo mode off

1. Add at least the projects you want on the homepage, with `draft` unset or `false`.
2. Fill `intro` and `contactLinks` in `profile.ts`.
3. Set `SITE_URL` once a domain exists.
4. Run `npm test && npm run build`. The build runs the type check first.
5. Optionally run the rendered QA (see README) against the new build.

## Hero artwork

`src/content/site.ts` → `HERO`:

- `'koi'` (current): a koi pond.
- `'field'`: the wind field, or a video clip as described below.

## Hero artwork from a video

The hero field can play a pre-converted video loop instead of the generated pattern.
Visitors download only the converted character data, never the video.

```sh
npm run field:convert -- path/to/clip.mov --name grass --segments 2-8,10-15
```

This writes `public/field/grass.wide.json` and `public/field/grass.narrow.json`. To use them, set
`HERO = 'field'` and `FIELD_CLIP = 'grass'` in `src/content/site.ts`. Run `npm run field:convert` with no arguments
to see every option (fps, density, dissolve length, crop focus, poster frame).

### Subject only (no background)

To keep just a person and drop everything around them, make a mask video first, then pass it
to the converter. Only the masked area becomes characters.

```sh
pip install numpy pillow scipy ai-edge-litert
curl -LO https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite
python3 scripts/person-mask.py clip.mov mask.mkv --model selfie_multiclass_256x256.tflite
npm run field:convert -- clip.mov --name figure --mask mask.mkv --gain 1.25 --segments 3-8,9-14
```

Close or medium framing works best, because a person far away ends up only a few characters
tall. The model file stays outside the repo.

Use footage you shot yourself or have a licence for. Slow, high-contrast footage with no
on-screen text converts best.
