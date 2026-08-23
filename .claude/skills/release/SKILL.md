---
name: release
description: Cut an OverDose release and write its Basecamp release notes. Use when asked to release, cut a version, tag a version, ship a release, publish a version, or write release notes for OverDose.
---

# Releasing OverDose

**Read `overdose/docs/releasing.md` first.** It is the authority — full
procedure, the house style for the notes, and the mistakes already made. This
file exists to make sure you open it instead of reconstructing the process from
memory, which is how the mistakes happened.

Every release has **two** deliverables:

1. **The tag.** CI does everything else.
2. **Short release notes**, posted as a comment on the existing Basecamp thread
   ("Introducing OverDose - a new skin", Decent Diaspora → Programmer's Forum).
   Never automated, always needed, and nobody else writes them.

## The tag

```bash
git tag --sort=-v:refname | head -3          # what was the last version
npx tsc --noEmit && npx vitest run && npm run build   # if you just merged
git tag v0.0.13 && git push origin v0.0.13
```

`.github/workflows/release.yml` then builds, stamps the version from the tag
into `dist/manifest.json`, zips the contents of `dist/`, and publishes a GitHub
Release with `overdose-<tag>.zip` attached. Verify:

```bash
curl -sf https://api.github.com/repos/rotium/OverDose/releases/tags/v0.0.13 \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["name"], [a["name"] for a in d["assets"]])'
```

## Do not

- **Do not hand-build the release zip.** CI attaches it. A session built
  `overdose-v0.0.12.zip` by hand off a stale note and it was pure duplication.
- **Do not bump the version in a commit.** `package.json` and
  `public/manifest.json` stay at the `0.0.1` dev default on main; the workflow
  stamps the tag. The bump/restore commit pairs on v0.0.8–v0.0.12 are leftovers.
- **Do not assume a step is manual** without reading `.github/workflows/`.
  `dev-release.yml` also exists: pushing to `dev` publishes a rolling
  `dev-build` pre-release, which is what `npm run deploy:tablet` uses to get a
  build onto hardware without burning a version.

## The notes

Style guide and skeleton are in `overdose/docs/releasing.md` — read that section
rather than guessing. In brief: bold title with a short slogan (playful for a
feature release, plain for a fix release), one framing line saying what the user
can now *do*, one line per item in plain English, `Fixed:` describing the
symptom rather than the cause, screenshots, and keep it short.
