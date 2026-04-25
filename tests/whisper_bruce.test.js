const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(__dirname, '..', 'whisper_bruce.js');
const whisperBruce = require(scriptPath);

test('createChoiceMap builds a plain menu mapping', () => {
  const menu = whisperBruce.createChoiceMap([
    ['Scan', 'scan'],
    ['Show matched devices', 'show'],
  ]);

  assert.deepEqual(menu, {
    Scan: 'scan',
    'Show matched devices': 'show',
  });
});

test('main menu choices keep the Bruce labels and actions', () => {
  assert.deepEqual(whisperBruce.createMainMenuChoices(), {
    'Select target (scan)': 'scan',
    'Show matched devices': 'show',
    'Trigger action': 'attack',
    'Pick song (.mp3)': 'pick',
    'Play song on target': 'play',
  });
});

test('device choices expose the first five numbered device entries', () => {
  assert.deepEqual(whisperBruce.createDeviceChoices(), {
    'Device #1': '1',
    'Device #2': '2',
    'Device #3': '3',
    'Device #4': '4',
    'Device #5': '5',
  });
});

test('script no longer uses computed property menu syntax that breaks older interpreters', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  assert.doesNotMatch(source, /\[["'][^\]]+["']\]\s*:/);
});
