# Releasing OverDose

Two deliverables every time: **the tag**, and **short release notes** for the
Basecamp thread. The notes aren't optional — every release in that thread has
them, and nobody else writes them.

## 1. What was the last version

```bash
git tag --sort=-v:refname | head -3
```

Next version is the next patch. Everything so far is `v0.0.x`.

## 2. Make sure main is green

`ci.yml` runs on every branch push and on main, and `release.yml` re-runs the
suite on the tagged commit — so a red main means a tag that publishes nothing.
If you've just merged, check locally too:

```bash
npx tsc --noEmit && npx vitest run && npm run build
```

## 3. Tag it

```bash
git tag v0.0.13 && git push origin v0.0.13
```

**That is the entire release.** `.github/workflows/release.yml` builds, stamps
the version from the tag into `dist/manifest.json`, zips the *contents* of
`dist/` (index.html at the zip root, as the gateway expects), and publishes a
GitHub Release with `overdose-<tag>.zip` attached. Gateways configured with
`github_release:rotium/OverDose` auto-update from that asset.

Verify it landed:

```bash
curl -sf https://api.github.com/repos/rotium/OverDose/releases/tags/v0.0.13 \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["name"], [a["name"] for a in d["assets"]])'
```

## 4. Write the release notes

Post as a **comment on the existing Basecamp thread** ("Introducing OverDose - a
new skin", Decent Diaspora → Programmer's Forum) — not a new message.

House style, taken from the posts already there:

- **Bold title line**: `**OverDose v0.0.13 — <short slogan>** <emoji>`. Playful
  suits a feature release ("just add water 💧", "it's time to let off some steam
  ♨♨♨"); plain suits a fix release ("OverDose v0.0.10 - Some bug fixes").
- **One framing line** — what you can now *do*, not a summary of the work.
- **One line per item.** Bold the feature name, then plain English about what it
  does for the user. No implementation detail, no file names, no jargon.
- **`Fixed:`** describes the *symptom* they saw ("typing 18 left you with 1"),
  not the cause.
- Warm, second person. First person for intent ("I'd keep an eye on…").
- Credit anyone whose suggestion shipped, by @-mention.
- **Screenshots.** Every release post has them.

Skeleton:

```
**OverDose v0.0.13 — <slogan>** <emoji>

<one line: what you can now do>

- **<Feature>** — <what it does for you>.
- **<Feature>** — <what it does for you>.

Fixed: <symptom>, and <symptom>.
```

Keep it short — five bullets is plenty. The detail lives in the app.

## Mistakes already made here

- **Don't hand-build the zip.** CI attaches it. A session built
  `overdose-v0.0.12.zip` by hand because a stale note claimed `gh` wasn't
  available — pure duplication, and it left junk in the repo root.
- **Don't do the version-bump/restore commit dance.** `package.json` and
  `public/manifest.json` stay at the `0.0.1` dev default on main; the workflow
  overwrites the version from the tag. Tags v0.0.8–v0.0.12 carry net-zero
  bump/restore commit pairs from before that was true.
- **Read `.github/workflows/` before assuming a step is manual.** There's also
  `dev-release.yml`: pushing to `dev` publishes a rolling `dev-build`
  pre-release, which is how `npm run deploy:tablet` gets a build onto hardware
  without burning a version number.
- **A tag can't be un-published cleanly.** If the tagged commit fails CI, no
  release appears but the tag exists. To retry:
  `git push --delete origin vX && git tag -d vX`, then fix and re-tag.
