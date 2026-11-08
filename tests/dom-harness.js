// Shared jsdom harness for the deployable page.
// Run from a checkout with: npm install && npm test
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const project = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(project, name), 'utf8');

function param(value) {
  return {
    value,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    setTargetAtTime() {},
    cancelScheduledValues() {},
  };
}

function node() {
  return { connect() {}, disconnect() {} };
}

class FakeSource {
  constructor() {
    this.buffer = null;
    this.onended = null;
  }
  connect() {}
  start() { setTimeout(() => { if (this.onended) this.onended(); }, 0); }
  stop() {}
}

class FakeAudioContext {
  constructor() {
    this.sampleRate = 48000;
    this.state = 'running';
    this.baseLatency = 0.01;
    this.outputLatency = 0.02;
    this.destination = node();
    this._start = Date.now();
  }
  get currentTime() { return (Date.now() - this._start) / 1000; }
  createGain() { return { ...node(), gain: param(1) }; }
  createDynamicsCompressor() {
    return {
      ...node(),
      threshold: param(-3),
      knee: param(0),
      ratio: param(20),
      attack: param(0.003),
      release: param(0.1),
    };
  }
  createBiquadFilter() {
    return { ...node(), type: '', frequency: param(1500), Q: param(0.7), gain: param(0) };
  }
  createBuffer(channels, length, sampleRate) {
    return {
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    };
  }
  createBufferSource() { return new FakeSource(); }
  decodeAudioData(buffer, success) {
    const result = { duration: 300, length: 300 * 48000, sampleRate: 48000 };
    if (success) success(result);
    return Promise.resolve(result);
  }
  resume() { return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pageHtml() {
  return read('index.html')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b[^>]*>/gi, '');
}

function appBundle() {
  return ['core.js', 'audio-engine.js', 'time-sync.js', 'observability.js', 'app.js']
    .map(read)
    .join('\n');
}

async function boot(options = {}) {
  const dom = new JSDOM(pageHtml(), {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'http://localhost/time-station-simulator/',
  });
  const { window } = dom;
  const errors = [];
  window.addEventListener('error', event => errors.push(String(event.error || event.message)));
  window.console.error = (...args) => errors.push(args.map(String).join(' '));
  window.console.warn = () => {};
  window.console.info = () => {};
  window.console.log = () => {};
  const style = window.document.createElement('style');
  style.textContent = `${read('tailwind.css')}\n${read('styles.css')}`;
  window.document.head.appendChild(style);
  window.AudioContext = FakeAudioContext;
  window.fetch = options.fetch || (async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  if (options.localStorage) {
    Object.entries(options.localStorage).forEach(([key, value]) => {
      window.localStorage.setItem(key, value);
    });
  }
  window.eval(read('audio/wwv/sprite.js'));
  window.eval(appBundle());
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  await wait(250);
  return { dom, window, errors };
}

module.exports = { boot, wait };
