import Accelerate
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

  // The extension is hard-capped at 50 MB; iOS kills the whole broadcast if
  // we cross it. Frames are reduced to a downscaled grayscale plane via
  // vImage (no CoreImage/Metal — that context's baseline alone is ~15 MB),
  // and recognition degrades to .fast / skips frames as footprint climbs.
  private let maxOcrDimension = 1024
  private let skipFrameFootprintMb = 40.0
  private var lumaBuffer: CVPixelBuffer?
  private var lumaWidth = 0
  private var lumaHeight = 0

  private let ocrQueue = DispatchQueue(label: "hx2.ocr", qos: .utility)
  private var ocrBusy = false

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

    // Never block this callback: replayd (the system broadcast daemon) owns
    // every in-flight frame, and its own Jetsam limit is tiny (~20 MB). If
    // OCR runs synchronously here, frames back up inside replayd until iOS
    // kills it and the whole broadcast ends. So: drop frames while OCR is
    // busy, copy out a small luma buffer, and do the slow work on our queue.
    guard !ocrBusy else { return }

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

    let footprintMb = Self.footprintMb()
    sharedDefaults?.set(footprintMb, forKey: "hx2.memFootprintMb")
    if footprintMb > skipFrameFootprintMb { return }

    guard let luma = downscaledLuma(fullBuffer) else { return }
    ocrBusy = true
    let timestampMs = Int64(now * 1000)
    ocrQueue.async { [weak self] in
      guard let self = self else { return }
      autoreleasepool { self.runOcr(luma: luma, timestampMs: timestampMs) }
      self.ocrBusy = false
    }
  }

  private func runOcr(luma: CVPixelBuffer, timestampMs: Int64) {
    let request = VNRecognizeTextRequest()
    // .accurate's ML models alone blow the 50 MB extension cap on A11-era
    // devices (measured: jetsam at ~52 MB during the first pass). .fast uses
    // a far smaller pipeline and handles high-contrast UI text well.
    request.recognitionLevel = .fast
    // IPs, hex wallets and handles like "hx84d9...762d" must come through
    // verbatim; language correction rewrites them into English words.
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]

    let handler = VNImageRequestHandler(cvPixelBuffer: luma, orientation: .up)
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

    writeSnapshot(lines: lines, timestampMs: timestampMs)
  }

  // ReplayKit delivers 420 biplanar frames; plane 0 is the grayscale luma,
  // which is all OCR needs. Scaling just that plane keeps the working set to
  // a couple of MB. Falls back to the raw frame for non-planar formats.
  private func downscaledLuma(_ source: CVPixelBuffer) -> CVPixelBuffer? {
    guard CVPixelBufferGetPlaneCount(source) >= 2 else { return source }
    CVPixelBufferLockBaseAddress(source, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(source, .readOnly) }
    guard let srcBase = CVPixelBufferGetBaseAddressOfPlane(source, 0) else { return nil }
    let srcW = CVPixelBufferGetWidthOfPlane(source, 0)
    let srcH = CVPixelBufferGetHeightOfPlane(source, 0)
    let srcRowBytes = CVPixelBufferGetBytesPerRowOfPlane(source, 0)

    let longest = max(srcW, srcH)
    let scale = longest > maxOcrDimension ? Double(maxOcrDimension) / Double(longest) : 1.0
    let dstW = max(1, Int((Double(srcW) * scale).rounded()))
    let dstH = max(1, Int((Double(srcH) * scale).rounded()))

    if lumaBuffer == nil || lumaWidth != dstW || lumaHeight != dstH {
      var created: CVPixelBuffer?
      CVPixelBufferCreate(nil, dstW, dstH, kCVPixelFormatType_OneComponent8, nil, &created)
      lumaBuffer = created
      lumaWidth = dstW
      lumaHeight = dstH
    }
    guard let target = lumaBuffer else { return nil }

    CVPixelBufferLockBaseAddress(target, [])
    defer { CVPixelBufferUnlockBaseAddress(target, []) }
    guard let dstBase = CVPixelBufferGetBaseAddress(target) else { return nil }

    var srcVimage = vImage_Buffer(
      data: srcBase,
      height: vImagePixelCount(srcH),
      width: vImagePixelCount(srcW),
      rowBytes: srcRowBytes)
    var dstVimage = vImage_Buffer(
      data: dstBase,
      height: vImagePixelCount(dstH),
      width: vImagePixelCount(dstW),
      rowBytes: CVPixelBufferGetBytesPerRow(target))
    let err = vImageScale_Planar8(&srcVimage, &dstVimage, nil, vImage_Flags(kvImageNoFlags))
    return err == kvImageNoError ? target : nil
  }

  private static func footprintMb() -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(
      MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let result = withUnsafeMutablePointer(to: &info) { infoPtr in
      infoPtr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { intPtr in
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), intPtr, &count)
      }
    }
    guard result == KERN_SUCCESS else { return 0 }
    return Double(info.phys_footprint) / 1_048_576
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
