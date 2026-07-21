import ExpoModulesCore
import ReplayKit

public class HX2GameReaderModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HX2GameReader")

    // file:// URL of the app-group snapshot queue the broadcast extension
    // writes into. Nil when no app-group container is available.
    Function("getQueueDirectoryUri") { () -> String? in
      guard
        let container = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: Self.appGroupId)
      else { return nil }
      let dir = container.appendingPathComponent("gamereader/queue", isDirectory: true)
      try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      return dir.absoluteString
    }

    // Unix seconds of the last frame the broadcast extension received; 0 if never.
    Function("lastFrameAt") { () -> Double in
      UserDefaults(suiteName: Self.appGroupId)?.double(forKey: "hx2.lastFrameTs") ?? 0
    }

    // The extension skips OCR while this heartbeat is fresh, so the
    // companion's own screens are never captured into the database.
    Function("setCompanionForeground") { (active: Bool) in
      UserDefaults(suiteName: Self.appGroupId)?
        .set(active ? Date().timeIntervalSince1970 : 0, forKey: "hx2.companionForegroundTs")
    }

    AsyncFunction("launchBroadcastPicker") {
      let picker = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
      if let bundleId = Bundle.main.bundleIdentifier {
        picker.preferredExtension = "\(bundleId).broadcast"
      }
      picker.showsMicrophoneButton = false
      for view in picker.subviews {
        if let button = view as? UIButton {
          button.sendActions(for: .allTouchEvents)
        }
      }
    }.runOnQueue(.main)
  }

  // Sideloading rewrites the app group (e.g. "group.TEAMID.com.trakker3.app"),
  // so the real value must come from the embedded provisioning profile rather
  // than a compiled-in constant. Falls back to the unsigned default.
  private static let appGroupId: String = {
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
  }()
}
