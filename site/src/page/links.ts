// Where the page sends people. The zips are the names the release workflow
// gives them (.github/workflows/release.yml).
export const REPO = "https://github.com/voronizer/rehearsal-recorder"
export const RELEASES = `${REPO}/releases`
export const MAC_ZIP = `${RELEASES}/latest/download/RehearsalRecorder-macos.zip`
export const WINDOWS_ZIP = `${RELEASES}/latest/download/RehearsalRecorder-windows.zip`
export const releaseNotes = (tag: string) => `${RELEASES}/tag/${tag}`
export const GUIDE = `${REPO}/blob/main/docs/using-it.md`
export const CHANGES = `${REPO}/blob/main/CHANGELOG.md`
export const NEW_ISSUE = `${REPO}/issues/new/choose`
