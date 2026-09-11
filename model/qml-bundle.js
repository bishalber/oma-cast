.pragma library

// Shared string/JSON helpers used across parsers and CLI builders.
// Kept dependency-free so every model module can import it safely.

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

// Omarchy settings may arrive as strings ("true", "1", "on"); coerce to boolean.
function settingBool(value, fallback) {
  if (value === undefined || value === null || value === "") return !!fallback
  if (typeof value === "boolean") return value
  var text = String(value).trim().toLowerCase()
  return text === "1" || text === "true" || text === "yes" || text === "on"
}

function safeJson(raw) {
  var text = normalizeText(raw)
  if (text === "") return null
  try {
    return JSON.parse(text)
  } catch (e) {
    return null
  }
}

function arrayOf(value) {
  return Array.isArray(value) ? value : []
}

// Canonical casting protocol names for the panel and FluxCast CLI flags.
// Collapse aliases (miracast, cast, …) into wfd | dlna | chromecast.
function normalizeProtocol(value) {
  var protocol = normalizeText(value).toLowerCase()
  if (protocol === "miracast" || protocol === "wfd") return "wfd"
  if (protocol === "dlna") return "dlna"
  if (protocol === "chromecast" || protocol === "cast") return "chromecast"
  return "wfd"
}

// FluxCast uses "cast" on the command line; the panel uses "chromecast".
function fluxcastProtocol(value) {
  var protocol = normalizeProtocol(value)
  if (protocol === "chromecast") return "cast"
  return protocol
}

function protocolLabel(value) {
  var protocol = normalizeProtocol(value)
  if (protocol === "dlna") return "DLNA"
  if (protocol === "chromecast") return "Chromecast"
  return "Miracast / WFD"
}

// Human-readable elapsed timers for the bar tooltip and panel summary.

function formatElapsed(seconds) {
  var value = Math.max(0, Math.floor(Number(seconds) || 0))
  var hours = Math.floor(value / 3600)
  var minutes = Math.floor((value % 3600) / 60)
  var secs = value % 60
  function pad(n) { return n < 10 ? "0" + n : String(n) }
  if (hours > 0) return hours + ":" + pad(minutes) + ":" + pad(secs)
  return pad(minutes) + ":" + pad(secs)
}

// Prefer a live Date when the panel tracks start time; fall back to FluxCast status JSON.
function elapsedSeconds(startedAt, fallbackSeconds) {
  var elapsed = Number(fallbackSeconds || 0)
  if (startedAt && startedAt.getTime && startedAt.getTime() > 0) {
    var diff = Math.floor((Date.now() - startedAt.getTime()) / 1000)
    if (isFinite(diff) && diff >= 0) elapsed = diff
  }
  return Math.max(0, Math.floor(elapsed))
}

// User-facing messages when a FluxCast subprocess exits non-zero.
function processFailureMessage(operation, exitCode, stderrText) {
  var stderr = normalizeText(stderrText)
  if (stderr !== "") return "FluxCast " + operation + " failed: " + stderr
  return "FluxCast " + operation + " failed with exit code " + exitCode + "."
}

function recoveryHint(operation) {
  if (operation === "doctor") return "Check that FluxCast, wf-recorder, ffmpeg, and Wi-Fi Direct support are installed."
  if (operation === "scan") return "Make sure the Wi-Fi Direct adapter is available and retry scan."
  if (operation === "status") return "Refresh the panel or inspect the FluxCast log."
  if (operation === "stop") return "If FluxCast is still active, stop it from the tray or retry stop."
  if (operation === "start") return "Review the selected device and monitor, then try again."
  return "Review the selected device and monitor, then try again."
}

// Enrich a parsed result in place; only fills empty error/hint fields.
function applyExitCode(result, operation, exitCode, stderrText, messageKey) {
  if (exitCode === 0) return result
  if (normalizeText(result[messageKey]) === "")
    result[messageKey] = processFailureMessage(operation, exitCode, stderrText)
  if (normalizeText(result.hint) === "")
    result.hint = recoveryHint(operation)
  return result
}

// Stable keys and display labels for cast targets and Hyprland outputs.
// First non-empty field wins — FluxCast and hyprctl use different property names.
function entityKey(entity, fields) {
  if (!entity) return ""
  for (var i = 0; i < fields.length; i++) {
    var value = normalizeText(entity[fields[i]])
    if (value !== "") return value
  }
  return ""
}

function findByKey(list, key, keyFn) {
  var values = arrayOf(list)
  var wanted = normalizeText(key)
  if (wanted === "") return null
  for (var i = 0; i < values.length; i++) {
    if (keyFn(values[i]) === wanted) return values[i]
  }
  return null
}

function deviceKey(device) {
  return entityKey(device, ["selector", "address", "name"])
}

function monitorKey(monitor) {
  return entityKey(monitor, ["selector", "address", "name"])
}

function deviceLabel(device) {
  if (!device) return "Unknown device"
  var name = normalizeText(device.name || device.label || device.displayName)
  if (name !== "") return name
  return normalizeText(device.address || device.selector || "Unknown device")
}

function deviceSubtitle(device) {
  if (!device) return ""
  var parts = []
  if (normalizeText(device.address) !== "") parts.push(normalizeText(device.address))
  if (normalizeText(device.protocol) !== "") parts.push(protocolLabel(device.protocol))
  return parts.join(" · ")
}

function monitorLabel(monitor) {
  if (!monitor) return "Unknown monitor"
  var name = normalizeText(monitor.name || monitor.selector || monitor.address)
  var description = normalizeText(monitor.description)
  var size = []
  if (Number(monitor.width) > 0 && Number(monitor.height) > 0)
    size.push(Number(monitor.width) + "x" + Number(monitor.height))
  var parts = []
  if (name !== "") parts.push(name)
  if (description !== "") parts.push(description)
  if (size.length > 0) parts.push(size.join(" "))
  return parts.join(" · ") || "Unknown monitor"
}

function deviceByKey(devices, key) {
  return findByKey(devices, key, deviceKey)
}

function monitorByKey(monitors, key) {
  return findByKey(monitors, key, monitorKey)
}

// Session lifecycle: log-line detection and panel state resolution.
// True when FluxCast stdout indicates media is flowing (not merely connecting).
function isSessionReadyLine(line) {
  var text = normalizeText(line).toLowerCase()
  if (text === "") return false
  if (text.indexOf("play accepted") !== -1) return true
  if (text.indexOf("media stream started") !== -1) return true
  if (text.indexOf("casting started") !== -1) return true
  if (text.indexOf("output signal sent") !== -1) return true
  return false
}

// Derive the next bar/panel state from subprocess flags and the triggering action.
// "poll" is the periodic refresh path; other actions come from user IPC.
function resolveSessionState(input) {
  var options = input || {}
  var current = normalizeText(options.currentState) || "idle"
  var running = !!options.running || !!options.startInFlight
  var sessionReady = !!options.sessionReady
  var scanInFlight = !!options.scanInFlight
  var available = !!options.fluxcastAvailable
  var action = normalizeText(options.action) || "poll"
  var live = current === "casting" || current === "connecting" || running || sessionReady
  var scanning = current === "scanning" || scanInFlight

  if (action === "exit") return options.errorState ? "error" : (available ? "idle" : "unavailable")

  if (live && (action === "scan" || action === "doctor-fail" || action === "poll")) {
    if (sessionReady || current === "casting") return "casting"
    return running || current === "connecting" ? "connecting" : current
  }

  if (scanning && action === "poll") return "scanning"

  if (action === "scan") return "scanning"
  if (options.errorState) return "error"
  if (!available) return "unavailable"
  return "idle"
}

// Bar icon, tooltip, and panel summary strings derived from session state.
var STATE_META = {
  casting: { label: "Casting", icon: "󰿎" },
  connecting: { label: "Connecting", icon: "󰐊" },
  scanning: { label: "Scanning", icon: "󰄬" },
  error: { label: "Error", icon: "󰅙" },
  idle: { label: "Idle", icon: "󰄘" }
}

var BAR_CAST_ICON = STATE_META.idle.icon

function barIcon() {
  return BAR_CAST_ICON
}

function stateMeta(state) {
  var value = normalizeText(state)
  return STATE_META[value] || { label: "Unavailable", icon: "󰅚" }
}

function iconForState(state) {
  return stateMeta(state).icon
}

function stateLabel(state) {
  return stateMeta(state).label
}

function barTooltip(state, target, protocol, elapsedSeconds) {
  var value = normalizeText(state)
  var label = stateLabel(value)
  if (value === "casting") {
    var parts = [label, protocolLabel(protocol)]
    var targetText = normalizeText(target)
    if (targetText !== "") parts.push(targetText)
    parts.push(formatElapsed(elapsedSeconds))
    return parts.join(" · ")
  }
  if (value === "error") return label
  return label + " · Open Oma Cast"
}

function statusSummary(state, protocol, target, monitor, elapsedSeconds) {
  var parts = [stateLabel(state), protocolLabel(protocol)]
  var targetText = normalizeText(target)
  var monitorText = normalizeText(monitor)
  if (targetText !== "") parts.push(targetText)
  if (monitorText !== "") parts.push(monitorText)
  if (normalizeText(state) === "casting") parts.push(formatElapsed(elapsedSeconds))
  return parts.join(" · ")
}

// Parse `fluxcast --doctor-json` into availability, version, and missing deps.
function parseDoctorPayload(raw) {
  var parsed = safeJson(raw)
  if (!parsed) {
    return {
      available: false,
      version: "",
      message: "FluxCast did not return valid diagnostics.",
      missing: [],
      hint: "Run `fluxcast --doctor-json` in a terminal to inspect the failure."
    }
  }

  var missing = []
  if (Array.isArray(parsed.missing)) missing = parsed.missing.slice()
  else if (Array.isArray(parsed.missingDependencies)) missing = parsed.missingDependencies.slice()
  else if (Array.isArray(parsed.dependenciesMissing)) missing = parsed.dependenciesMissing.slice()

  var checks = arrayOf(parsed.checks)
  var hasFail = false
  for (var i = 0; i < checks.length; i++) {
    var check = checks[i] || {}
    var status = normalizeText(check.status).toLowerCase()
    if (status === "fail") {
      hasFail = true
      missing.push(normalizeText(check.name || check.message || "dependency"))
    }
  }

  // Doctor JSON shape varies by FluxCast version; infer readiness from several flags.
  var available = parsed.available !== undefined ? !!parsed.available : !hasFail
  if (parsed.ok === false || parsed.installed === false || parsed.ready === false) available = false
  if (hasFail) available = false

  var message = normalizeText(parsed.message || parsed.error || parsed.summary || parsed.diagnostic)
  if (message === "" && !available) message = "FluxCast is not ready."
  if (message === "" && parsed.wfd_candidate === false)
    message = normalizeText(parsed.summary || "Miracast/WFD is not confirmed yet.")

  var version = normalizeText(parsed.version || parsed.fluxcastVersion || "")
  if (version === "") {
    for (var j = 0; j < checks.length; j++) {
      var runtime = checks[j] || {}
      if (normalizeText(runtime.name).toLowerCase() === "python") {
        version = normalizeText(runtime.detail || runtime.message)
        break
      }
    }
  }

  var hint = normalizeText(parsed.hint || parsed.recovery || parsed.recommendation)
  if (hint === "" && !available)
    hint = missing.length > 0 ? "Install the missing dependency, then retry." : "Check the FluxCast log or reinstall FluxCast."
  if (hint === "" && parsed.wfd_candidate === false)
    hint = "Fix the warn/fail rows in doctor output, then retry scan."

  return {
    available: available,
    version: version,
    message: message,
    missing: missing,
    hint: hint
  }
}

function normalizeDoctor(raw, exitCode, stderrText) {
  var parsed = parseDoctorPayload(raw)
  return applyExitCode(parsed, "doctor", exitCode, stderrText, "message")
}

// Normalize FluxCast scan output: JSON when available, WFD text scan as fallback.
function parseDevicesPayload(raw) {
  var parsed = safeJson(raw)
  if (!parsed) return { devices: [], error: "FluxCast scan output was not valid JSON.", hint: "Rescan or open the FluxCast log." }

  var values = arrayOf(parsed.devices || parsed.results || parsed.items || parsed.data)
  var protocol = normalizeProtocol(parsed.protocol || parsed.mode || "wfd")
  var devices = []

  for (var i = 0; i < values.length; i++) {
    var device = values[i] || {}
    var next = {
      name: normalizeText(device.name || device.label || device.displayName || device.title),
      address: normalizeText(device.address || device.mac || device.selector || ""),
      selector: normalizeText(device.selector || device.address || device.mac || device.name || ""),
      protocol: normalizeProtocol(device.protocol || protocol)
    }
    if (next.name === "") next.name = next.address !== "" ? next.address : "Unknown device"
    devices.push(next)
  }

  return {
    devices: devices,
    error: normalizeText(parsed.error || parsed.message || ""),
    hint: normalizeText(parsed.hint || "")
  }
}

// Parse `fluxcast --wfd-scan` plain-text lines: `[0] aa:bb:cc:dd:ee:ff Name`.
function parseWfdScanOutput(raw) {
  var text = String(raw || "")
  var devices = []
  var lines = text.split(/\r?\n/)
  var peerRe = /^\s*\[(\d+)\]\s+([0-9a-fA-F:]{17})(.*)$/

  for (var i = 0; i < lines.length; i++) {
    var match = lines[i].match(peerRe)
    if (!match) continue
    var index = match[1]
    var address = match[2]
    var tail = normalizeText(match[3]).replace(/\s+via\s+.*$/i, "")
    devices.push({
      name: tail !== "" ? tail : address,
      address: address,
      selector: index,
      protocol: "wfd"
    })
  }

  var error = ""
  var errorMatch = text.match(/ERROR:\s*(.+)/)
  if (errorMatch) error = normalizeText(errorMatch[1])

  return { devices: devices, error: error, hint: "" }
}

// Try JSON first; if empty, parse WFD text and apply scan-specific empty-state hints.
function normalizeDevices(raw, exitCode, stderrText) {
  var stderr = normalizeText(stderrText)
  var combined = normalizeText(raw)
  if (stderr !== "") combined = combined + "\n" + stderr

  var parsed = parseDevicesPayload(raw)
  if (parsed.devices.length > 0) {
    return applyExitCode({
      devices: parsed.devices,
      raw: normalizeText(raw),
      error: parsed.error,
      hint: parsed.hint
    }, "scan", exitCode, stderrText, "error")
  }

  var scan = parseWfdScanOutput(combined)
  var error = scan.error
  if (exitCode !== 0 && error === "") error = processFailureMessage("scan", exitCode, stderrText)
  var hint = scan.hint
  if (exitCode !== 0 && hint === "") hint = recoveryHint("scan")
  if (exitCode === 0 && scan.devices.length === 0 && error === "") {
    error = "No Wi-Fi Direct peers found."
    hint = "Put the TV into Screen Share or Wireless Display mode, then scan again."
  }
  return { devices: scan.devices, raw: combined, error: error, hint: hint }
}

// Normalize monitor lists from FluxCast JSON or `hyprctl monitors -j`.
function parseMonitorsPayload(raw) {
  var parsed = safeJson(raw)
  if (!parsed) return { monitors: [], error: "FluxCast monitor output was not valid JSON.", hint: "Reconnect the monitor or retry refresh." }

  var values = arrayOf(parsed.monitors || parsed.displays || parsed.outputs || parsed.items || parsed.data)
  var monitors = []

  for (var i = 0; i < values.length; i++) {
    var monitor = values[i] || {}
    monitors.push({
      name: normalizeText(monitor.name || monitor.selector || monitor.address),
      selector: normalizeText(monitor.selector || monitor.name || monitor.address || ""),
      address: normalizeText(monitor.address || ""),
      description: normalizeText(monitor.description || monitor.label || ""),
      width: Number(monitor.width || monitor.w || 0),
      height: Number(monitor.height || monitor.h || 0)
    })
  }

  return {
    monitors: monitors,
    error: normalizeText(parsed.error || parsed.message || ""),
    hint: normalizeText(parsed.hint || "")
  }
}

// Hyprland returns a top-level JSON array; map name → selector for start args.
function parseHyprctlMonitorsPayload(raw) {
  var parsed = safeJson(raw)
  if (!parsed || !Array.isArray(parsed)) {
    return {
      monitors: [],
      error: "Could not read monitors from hyprctl.",
      hint: "Make sure Hyprland is running, then refresh."
    }
  }

  var monitors = []
  for (var i = 0; i < parsed.length; i++) {
    var monitor = parsed[i] || {}
    monitors.push({
      name: normalizeText(monitor.name),
      selector: normalizeText(monitor.name),
      address: "",
      description: normalizeText(monitor.description),
      width: Number(monitor.width || 0),
      height: Number(monitor.height || 0)
    })
  }

  return { monitors: monitors, error: "", hint: "" }
}

function normalizeMonitors(raw, exitCode, stderrText) {
  var parsed = parseMonitorsPayload(raw)
  if (parsed.monitors.length > 0) {
    return applyExitCode({
      monitors: parsed.monitors,
      raw: normalizeText(raw),
      error: parsed.error,
      hint: parsed.hint
    }, "monitors", exitCode, stderrText, "error")
  }

  var hypr = parseHyprctlMonitorsPayload(raw)
  if (exitCode !== 0 && hypr.error === "")
    hypr.error = processFailureMessage("monitors", exitCode, stderrText)
  if (exitCode !== 0 && hypr.hint === "") hypr.hint = recoveryHint("monitors")
  return { monitors: hypr.monitors, raw: normalizeText(raw), error: hypr.error, hint: hypr.hint }
}

// Parse `fluxcast --status-json` into a normalized session snapshot.
function parseStatusPayload(raw) {
  var parsed = safeJson(raw)
  if (!parsed) {
    return {
      state: "idle",
      protocol: "wfd",
      target: "",
      monitor: "",
      pid: 0,
      startedAtMs: 0,
      elapsedSeconds: 0,
      error: "FluxCast status output was not valid JSON.",
      hint: "Retry refresh or inspect the log."
    }
  }

  var state = normalizeText(parsed.state || parsed.status || "idle").toLowerCase()
  // FluxCast versions use different state names; map to the panel's finite set.
  if (state === "running" || state === "active") state = "casting"
  if (state !== "casting" && state !== "connecting" && state !== "scanning" && state !== "error" && state !== "idle")
    state = "idle"

  var startedAtMs = 0
  var startedAt = parsed.startedAt || parsed.started_at || parsed.started || parsed.startTime
  if (startedAt) {
    var asDate = new Date(startedAt)
    if (!isNaN(asDate.getTime())) startedAtMs = asDate.getTime()
  }

  return {
    state: state,
    protocol: normalizeProtocol(parsed.protocol || parsed.mode || "wfd"),
    target: normalizeText(parsed.target || parsed.device || parsed.deviceName || ""),
    monitor: normalizeText(parsed.monitor || parsed.output || parsed.display || ""),
    pid: Number(parsed.pid || 0) || 0,
    startedAtMs: startedAtMs,
    elapsedSeconds: Number(parsed.elapsedSeconds || parsed.elapsed || 0) || 0,
    error: normalizeText(parsed.error || parsed.message || ""),
    hint: normalizeText(parsed.hint || "")
  }
}

function normalizeStatus(raw, exitCode, stderrText) {
  var parsed = parseStatusPayload(raw)
  return applyExitCode(parsed, "status", exitCode, stderrText, "error")
}

// Build argv arrays for FluxCast scan and start subprocesses.
function resolveFluxcastBin(fluxcastBin) {
  return normalizeText(fluxcastBin) || "fluxcast"
}

// Only WFD exposes a CLI scan today; DLNA/Chromecast use the FluxCast tray.
function buildScanArgs(protocol, fluxcastBin) {
  var binary = resolveFluxcastBin(fluxcastBin)
  if (normalizeProtocol(protocol) === "wfd") return [binary, "--wfd-scan"]
  return null
}

function buildStartArgs(protocol, device, monitor, settings, fluxcastBin) {
  var binary = resolveFluxcastBin(fluxcastBin)
  var proto = fluxcastProtocol(protocol)
  var args = [binary, "--protocol", proto]
  var deviceKeyValue = deviceKey(device)
  var monitorKeyValue = monitorKey(monitor)

  // WFD peers are indexed by scan slot; other protocols match by device name.
  if (proto === "wfd") {
    if (deviceKeyValue !== "") {
      args.push("--wfd-peer")
      args.push(deviceKeyValue)
    }
  } else if (deviceKeyValue !== "") {
    args.push("--device-name")
    args.push(deviceKeyValue)
  }

  if (monitorKeyValue !== "") {
    args.push("--monitor")
    args.push(monitorKeyValue)
  }

  var options = settings || {}
  var fps = Number(options.fps || 0)
  if (isFinite(fps) && fps > 0) {
    args.push("--fps")
    args.push(String(Math.round(fps)))
  }

  var bitrate = normalizeText(options.bitrate)
  if (bitrate !== "") {
    args.push("--bitrate")
    args.push(bitrate)
  }

  var backend = normalizeText(options["wfd-capture-backend"])
  if (proto === "wfd" && backend !== "") {
    args.push("--wfd-capture-backend")
    args.push(backend)
  }

  if (proto === "wfd" && settingBool(options["wfd-no-audio"], false)) args.push("--wfd-no-audio")
  if (proto === "wfd" && settingBool(options["wfd-aosp-pmt-pid"], false)) args.push("--wfd-aosp-pmt-pid")

  return args
}

// Small helpers wired from Panel.qml (log paths, process restart guard).
var SESSION_LOG = "/tmp/fluxcast-cast.log"

function defaultLogFile() {
  return SESSION_LOG
}

function logPathsToOpen(configuredPath) {
  var sessionLog = defaultLogFile()
  var configured = normalizeText(configuredPath)
  if (configured === "") return [sessionLog]
  if (configured === sessionLog) return [sessionLog]
  return [configured, sessionLog]
}

// Block a new start while a cast subprocess is still launching or active.
function canRestartProcess(inFlight, running) {
  return !inFlight || !running
}

