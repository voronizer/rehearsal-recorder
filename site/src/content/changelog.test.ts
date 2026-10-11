import { describe, expect, it } from "vitest"
import { changelogHead, displayVersion, latestNews, latestVersion, newsLead } from "./changelog"

const CHANGELOG = `# Changelog

Intro.

## Unreleased

- **Something not out yet.** Soon.

## 0.9.0

- **The app says when a newer version is out.** A dot on the gear, and
  **Download** in Settings.
- **Download, in Updates**, fetches it.

## 0.8.0

- Plays sooner.
`

describe("latestVersion", () => {
  it("is the newest heading that is not Unreleased", () => {
    expect(latestVersion(CHANGELOG)).toBe("0.9.0")
  })
  it("is an error when there is none", () => {
    expect(() => latestVersion("# Changelog\n\n## Unreleased\n")).toThrow("CHANGELOG.md")
  })
})

describe("newsLead", () => {
  it("is the bold lead of the first item under the version", () => {
    expect(newsLead(CHANGELOG, "0.9.0")).toBe("The app says when a newer version is out.")
  })
  it("is null when the first item has no bold lead", () => {
    expect(newsLead(CHANGELOG, "0.8.0")).toBeNull()
  })
  it("is null when the version has no section", () => {
    expect(newsLead(CHANGELOG, "1.0.0")).toBeNull()
  })
})

// A release that changed only the site, between two that changed the app.
const QUIET = `# Changelog

## 0.9.1

- Nothing changed in the app.

## 0.9.0

- **The app says when a newer version is out.** A dot on the gear.

## 0.8.0

- Plays sooner.
`

describe("latestNews", () => {
  it("is the newest version's lead, not Unreleased's", () => {
    expect(latestNews(CHANGELOG)).toEqual({ version: "0.9.0", lead: "The app says when a newer version is out." })
  })
  it("passes over a release with nothing new in the app", () => {
    expect(latestNews(QUIET)).toEqual({ version: "0.9.0", lead: "The app says when a newer version is out." })
  })
  it("is null when no version has news", () => {
    expect(latestNews("# Changelog\n\n## 0.8.0\n\n- Plays sooner.\n")).toBeNull()
  })
})

describe("displayVersion", () => {
  it("drops a leading v", () => {
    expect(displayVersion("v1.0.0")).toBe("1.0.0")
    expect(displayVersion("0.9.0")).toBe("0.9.0")
  })
})

describe("changelogHead", () => {
  it("is the newest version's section alone, so the rest stays out of the page", () => {
    const head = changelogHead(CHANGELOG)
    expect(head).not.toContain("Unreleased")
    expect(head).toContain("## 0.9.0")
    expect(head).toContain("fetches it.")
    expect(head).not.toContain("## 0.8.0")
    expect(newsLead(head, latestVersion(head))).toBe("The app says when a newer version is out.")
  })
  it("reaches down to the version a release is for, when it is an older one", () => {
    expect(changelogHead(CHANGELOG, "0.8.0")).toContain("Plays sooner.")
    expect(changelogHead(CHANGELOG, "v0.8.0")).toContain("Plays sooner.")
  })
  it("is down to the newest version when the release's has no section", () => {
    expect(changelogHead(CHANGELOG, "1.0.0")).not.toContain("## 0.8.0")
  })
  it("runs on to the news before a release with nothing new, and no further", () => {
    for (const head of [changelogHead(QUIET, "0.9.1"), changelogHead(QUIET)]) {
      expect(head).toContain("## 0.9.1")
      expect(head).toContain("## 0.9.0")
      expect(head).not.toContain("## 0.8.0")
      expect(latestNews(head)).toEqual({ version: "0.9.0", lead: "The app says when a newer version is out." })
    }
  })
  it("is the release's own section when nothing down from it has news", () => {
    expect(changelogHead(QUIET, "0.8.0")).toBe("## 0.8.0\n\n- Plays sooner.\n")
  })
})
