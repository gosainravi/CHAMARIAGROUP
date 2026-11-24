# Remote PC for Mac — Design Spec

Date: 2026-11-25 · Status: approved in chat ("do the testing at your end and place the file")

## Goal
A macOS version of Remote PC that interoperates with the Windows app (Mac ↔ Windows, either side sharing or controlling), with the same features and security, published as `.dmg` downloads (Apple Silicon + Intel), marked Beta until tested on a real Mac.

## Approach
Share one core library between both apps so protocol, encryption and consent logic are identical:

- `SSConnect.Core` multi-targets `net48` (Windows app) and `net8.0` (Mac app). It holds everything platform-neutral: signaling client, relay link, secure channel, auth proof, session keys, control messages, tile packets, tile diffing on raw BGRA buffers, input gate, coordinate mapping, password, settings parsing, cert pinning, and the session logic (`SharedSide`, `ViewerSide`) written against small interfaces:
  - `IScreenSource` — capture primary display → BGRA pixels (+ include cursor flag).
  - `IImageCodec` — JPEG encode a rectangle of BGRA pixels; JPEG decode to BGRA.
  - `IInputInjector` — apply an `InputEvent` to the local OS.
- Windows app implements these with GDI+ / SendInput (behaviour unchanged).
- Mac app (`RemotePC.Mac`, Avalonia 11, .NET 8) implements them with CoreGraphics (`CGDisplayCreateImage` capture, `CGEvent*` input) and SkiaSharp JPEG.

## Mac specifics
- Key codes: the wire carries Windows virtual-key codes. Mac sender maps macOS key codes → VK; Mac receiver maps VK → macOS key codes (Cmd ↔ Win key mapping documented).
- Permissions: on start, check `CGPreflightScreenCaptureAccess` and `AXIsProcessTrusted`; show a panel with buttons that request access / open System Settings.
- Server and certificate pin identical to Windows (built into Core settings).
- UI mirrors Windows: header with RP logo, ID/password, partner ID/password/Connect, viewer window with Ask/Release control, quality, timer, End; Allow/Deny dialog; always-on-top control bar (red while controlled).

## Build & delivery
- GitHub Actions `macos-latest`: run Core tests under net8.0, `dotnet publish` self-contained for `osx-arm64` and `osx-x64`, assemble `Remote PC.app` (Info.plist, icon), ad-hoc codesign, build `REMOTE-PC-mac-arm64.dmg` and `REMOTE-PC-mac-intel.dmg`, attach to the `remote-pc-latest` release.
- Smoke test on the runner: launch the app binary with `--smoke`, which connects to the production server, obtains an ID over pinned TLS, derives keys/encrypts a frame round trip, and exits 0.
- Not signed/notarized (needs Apple Developer account): users use System Settings → Open Anyway. Landing page shows Mac downloads labelled Beta with those instructions.

## Testing limits (explicit)
- Verified in CI: build, Core unit tests on macOS, app startup, server connection, encryption.
- Not verifiable without a real Mac: screen capture output, input injection, permission prompts, UI layout. First real test by the user.

## Out of scope
Notarization, Mac App Store, ScreenCaptureKit (CoreGraphics capture used; may need ScreenCaptureKit later on newest macOS), multi-monitor.
