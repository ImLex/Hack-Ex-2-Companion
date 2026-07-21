import CoreImage
import ReplayKit
import Vision

// Receives every frame of the system screen broadcast, OCRs one frame every
// couple of seconds, and writes the recognised lines as snapshot JSON into the
// App Group queue that the companion app drains — the iOS counterpart of the
// Android AccessibilityService. iOS kills broadcast extensions that exceed
// 50 MB, so frames are processed synchronously, one at a time, inside an
// autorelease pool.
private struct OCRLine {
  let row: Int
  let x: CGFloat
  let text: String
}

class SampleHandler: RPBroadcastSampleHandler {

  private let frameInterval: TimeInterval = 2.0
  private let heartbeatInterval: TimeInterval = 1.0
  // While the companion app itself is on screen its own UI must not be OCR'd
  // back into the database. The app heartbeats this flag every 2 s.
  private let companionPauseWindow: TimeInterval = 5.0
  private let maxQueueFiles = 300

  private var lastProcessed: TimeInterval = 0
  private var lastHeartbeat: TimeInterval = 0
  private var lastTextHash: Int = 0
  private var writesSinceTrim = 0

  // The extension is hard-capped at 50 MB; OCR at full screen resolution can
  // blow past that and iOS kills the whole broadcast. Frames are downscaled
  // into one reused buffer before Vision sees them.
  private let maxOcrDimension: CGFloat = 1024
  private lazy var ciContext = CIContext(options: [.cacheIntermediates: false])
  private var scaledBuffer: CVPixelBuffer?
  private var scaledWidth = 0
  private var scaledHeight = 0

  private lazy var appGroupId: String = Self.resolveAppGroupId()
  private lazy var sharedDefaults: UserDefaults? = UserDefaults(suiteName: appGroupId)
  private lazy var queueDir: URL? = {
    guard
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroupId)
    else { return nil }
    let dir = container.appendingPathComponent("gamereader/queue", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }()

  override func processSampleBuffer(
    _ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType
  ) {
    guard sampleBufferType == .video else { return }
    let now = Date().timeIntervalSince1970

    if now - lastHeartbeat >= heartbeatInterval {
      lastHeartbeat = now
      sharedDefaults?.set(now, forKey: "hx2.lastFrameTs")
    }

    // Let the session settle before the first OCR pass.
    if lastProcessed == 0 {
      lastProcessed = now
      return
    }
    guard now - lastProcessed >= frameInterval else { return }
    let companionTs = sharedDefaults?.double(forKey: "hx2.companionForegroundTs") ?? 0
    guard now - companionTs > companionPauseWindow else { return }
    guard let fullBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    lastProcessed = now

    autoreleasepool {
      guard let pixelBuffer = downscaleIfNeeded(fullBuffer) else { return }
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      // IPs, hex wallets and handles like "hx84d9...762d" must come through
      // verbatim; language correction rewrites them into English words.
      request.usesLanguageCorrection = false
      request.recognitionLanguages = ["en-US"]

      let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up)
      try? handler.perform([request])
      guard let observations = request.results, !observations.isEmpty else { return }

      // Reading order: top-to-bottom in coarse rows, then left-to-right.
      // Vision's normalized coordinates have their origin at the bottom-left.
      var items: [OCRLine] = []
      items.reserveCapacity(observations.count)
      for obs in observations {
        guard let text = obs.topCandidates(1).first?.string, !text.isEmpty else { continue }
        let box = obs.boundingBox
        let flippedMidY: CGFloat = 1.0 - box.midY
        let row = Int((flippedMidY * 100.0).rounded())
        items.append(OCRLine(row: row, x: box.minX, text: text))
      }
      guard !items.isEmpty else { return }
      items.sort { a, b in
        if a.row != b.row { return a.row < b.row }
        return a.x < b.x
      }
      let lines = items.map { $0.text }

      let joined = lines.joined(separator: "\n")
      guard joined.hashValue != lastTextHash else { return }
      lastTextHash = joined.hashValue

      writeSnapshot(lines: lines, timestampMs: Int64(now * 1000))
    }
  }

  private func downscaleIfNeeded(_ source: CVPixelBuffer) -> CVPixelBuffer? {
    let srcW = CVPixelBufferGetWidth(source)
    let srcH = CVPixelBufferGetHeight(source)
    let longest = CGFloat(max(srcW, srcH))
    if longest <= maxOcrDimension { return source }

    let scale = maxOcrDimension / longest
    let dstW = Int((CGFloat(srcW) * scale).rounded())
    let dstH = Int((CGFloat(srcH) * scale).rounded())

    if scaledBuffer == nil || scaledWidth != dstW || scaledHeight != dstH {
      var created: CVPixelBuffer?
      let attrs = [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary
      CVPixelBufferCreate(nil, dstW, dstH, kCVPixelFormatType_32BGRA, attrs, &created)
      scaledBuffer = created
      scaledWidth = dstW
      scaledHeight = dstH
    }
    guard let target = scaledBuffer else { return nil }

    let transform = CGAffineTransform(scaleX: scale, y: scale)
    let image = CIImage(cvPixelBuffer: source).transformed(by: transform)
    ciContext.render(image, to: target)
    return target
  }

  private func writeSnapshot(lines: [String], timestampMs: Int64) {
    guard let dir = queueDir else { return }
    let payload: [String: Any] = [
      "ts": timestampMs,
      "pkg": "ios.broadcast",
      "nodes": lines.map { ["text": $0] },
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
    try? data.write(to: dir.appendingPathComponent("\(timestampMs).json"), options: .atomic)

    writesSinceTrim += 1
    if writesSinceTrim >= 50 {
      writesSinceTrim = 0
      trimQueue(dir)
    }
  }

  // The app normally drains the queue; the cap only matters if it is not
  // opened for a very long broadcast session.
  private func trimQueue(_ dir: URL) {
    guard
      let files = try? FileManager.default.contentsOfDirectory(
        at: dir, includingPropertiesForKeys: nil)
    else { return }
    let sorted = files.filter { $0.pathExtension == "json" }
      .sorted { $0.lastPathComponent < $1.lastPathComponent }
    guard sorted.count > maxQueueFiles else { return }
    for file in sorted.prefix(sorted.count - maxQueueFiles) {
      try? FileManager.default.removeItem(at: file)
    }
  }

  // Sideloading (Sideloadly, AltStore, Xcode free account) rewrites the app
  // group to something like "group.TEAMID.com.trakker3.app", so the compiled-in
  // constant would miss the real container. The re-signed entitlements live in
  // the embedded provisioning profile; read the actual group from there.
  static func resolveAppGroupId() -> String {
    if let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
      let raw = try? Data(contentsOf: url),
      let start = raw.range(of: Data("<plist".utf8)),
      let end = raw.range(of: Data("</plist>".utf8)),
      let plist = try? PropertyListSerialization.propertyList(
        from: raw.subdata(in: start.lowerBound..<end.upperBound), options: [], format: nil)
        as? [String: Any],
      let entitlements = plist["Entitlements"] as? [String: Any],
      let groups = entitlements["com.apple.security.application-groups"] as? [String],
      let first = groups.first
    {
      return first
    }
    return "group.com.trakker3.app"
  }
}
