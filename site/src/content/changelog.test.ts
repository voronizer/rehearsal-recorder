import { describe, expect, it } from "vitest"
import { changelogHead, displayVersion, latestVersion, newsLead } from "./changelog"

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
})
