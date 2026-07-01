/* ============================================================
   JARVIS — Gesture Controlled Voice Assistant
   Uses TensorFlow.js Handpose for hand tracking
   ============================================================ */

// ─── State ───────────────────────────────────────────────────
const state = {
  handDetected: false,
  handStable: 0,
  twoHandStable: 0,
  twoHandSilenced: false,
  gesture: null,
  prevGesture: null,
  gestureStable: 0,
  gestureCooldown: 0,
  isTalking: false,
  swipeHistory: [],
  lastAction: '',
  speechQueue: [],
  speechPlaying: false,
  recognition: null,
  listening: false,
  voiceLastCmd: 0,
  voiceLastText: '',
  isProcessing: false,
  model: null,
  frameCount: 0,
  ai: { ready: false },
};

const CONFIG = {
  GESTURE_STABILITY: 8,
  GESTURE_COOLDOWN: 50,
  SWIPE_THRESHOLD: 0.012,
  SWIPE_FRAMES: 8,
  SPEECH_RATE: 1.0,
  SPEECH_PITCH: 1.1,
};

// ─── DOM ─────────────────────────────────────────────────────
const dom = {};

function initDOM() {
  dom.welcome = document.getElementById('welcome-screen');
  dom.launchBtn = document.getElementById('launch-btn');
  dom.app = document.getElementById('app');
  dom.webcam = document.getElementById('webcam');
  dom.canvas = document.getElementById('gesture-canvas');
  dom.ctx = dom.canvas.getContext('2d');
  dom.gestureName = document.getElementById('gesture-name');
  dom.fingerCount = document.getElementById('finger-count');
  dom.handStatus = document.getElementById('hand-status');
  dom.statusText = document.getElementById('status-text');
  dom.chatLog = document.getElementById('chat-log');
  dom.textInput = document.getElementById('text-input');
  dom.sendBtn = document.getElementById('send-btn');
  dom.voiceBtn = document.getElementById('voice-btn');
  dom.aiDot = document.getElementById('ai-dot');
  dom.aiStatusText = document.getElementById('ai-status-text');
}

// ─── Welcome ─────────────────────────────────────────────────
function launchApp() {
  dom.welcome.classList.add('hidden');
  dom.app.classList.add('visible');
  setTimeout(() => {
    initAI();
    setupSettings();
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      startCamera();
    } else {
      updateStatus('Camera not available');
      addSystem('Your browser does not support camera access.');
    }
  }, 400);
}

// ─── Chat ────────────────────────────────────────────────────
function addMessage(text, type = 'jarvis') {
  const msg = document.createElement('div');
  msg.className = `message ${type}`;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  msg.innerHTML = `${text}<div class="msg-time">${time}</div>`;
  dom.chatLog.appendChild(msg);
  dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
}

function addSystem(text) {
  addMessage(text, 'system');
}

// ─── Speech ──────────────────────────────────────────────────
function speak(text, callback) {
  if (!text) return;
  window.speechSynthesis.cancel();
  state.speechQueue.push({ text, callback });
  processSpeechQueue();
}

function processSpeechQueue() {
  if (state.speechPlaying || state.speechQueue.length === 0) return;
  state.speechPlaying = true;

  const item = state.speechQueue.shift();
  const utterance = new SpeechSynthesisUtterance(item.text);
  utterance.rate = CONFIG.SPEECH_RATE;
  utterance.pitch = CONFIG.SPEECH_PITCH;
  utterance.volume = 1;
  utterance.lang = 'en-US';

  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v =>
    v.name.includes('Microsoft David') || v.name.includes('Google UK') || v.name.includes('Male')
  );
  if (preferred) utterance.voice = preferred;

  utterance.onstart = () => { state.isTalking = true; updateStatus('Speaking...'); };
  utterance.onend = () => {
    state.isTalking = false;
    state.speechPlaying = false;
    updateStatus('Waiting for gesture...');
    if (item.callback) item.callback();
    processSpeechQueue();
  };
  utterance.onerror = () => {
    state.isTalking = false;
    state.speechPlaying = false;
    processSpeechQueue();
  };

  window.speechSynthesis.speak(utterance);
}

function cancelSpeech() {
  window.speechSynthesis.cancel();
  state.speechQueue = [];
  state.speechPlaying = false;
  state.isTalking = false;
  updateStatus('Waiting for gesture...');
  addSystem('Speech stopped.');
}

// ─── Gesture Classification ─────────────────────────────────
function countFingers(landmarks) {
  if (!landmarks || landmarks.length < 21) return 0;

  const tips = [4, 8, 12, 16, 20];
  const pips = [3, 6, 10, 14, 18];
  const mcp = [2, 5, 9, 13, 17];
  let count = 0;

  for (let i = 0; i < 5; i++) {
    const tip = landmarks[tips[i]];
    const pip = landmarks[pips[i]];
    const mcpPt = landmarks[mcp[i]];

    if (i === 0) {
      const dist = Math.hypot(tip[0] - mcpPt[0], tip[1] - mcpPt[1], tip[2] - mcpPt[2]);
      if (dist > 0.035) count++;
    } else {
      if (tip[1] < pip[1] - 0.015) count++;
    }
  }

  return count;
}

function detectSwipe(landmarks) {
  if (!landmarks || !landmarks[0]) return null;

  const wrist = landmarks[0];
  state.swipeHistory.push({ x: wrist[0], y: wrist[1], t: performance.now() });

  if (state.swipeHistory.length > CONFIG.SWIPE_FRAMES) state.swipeHistory.shift();
  if (state.swipeHistory.length < CONFIG.SWIPE_FRAMES) return null;

  const first = state.swipeHistory[0];
  const last = state.swipeHistory[state.swipeHistory.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const dt = last.t - first.t;

  if (dt > 500) return null;
  const speed = Math.sqrt(dx * dx + dy * dy);
  if (speed < CONFIG.SWIPE_THRESHOLD) return null;

  return Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? 'swipe_right' : 'swipe_left')
    : (dy > 0 ? 'swipe_down' : 'swipe_up');
}

function detectThumbsUp(landmarks) {
  if (!landmarks) return false;
  const tip4 = landmarks[4];
  const tip3 = landmarks[3];
  const mcp2 = landmarks[2];

  const thumbExtended = Math.hypot(tip4[0] - mcp2[0], tip4[1] - mcp2[1]) > 0.05;
  const thumbUp = tip4[1] < tip3[1] - 0.01;

  const fingersClosed = [8, 12, 16, 20].every(i => landmarks[i][1] > landmarks[i - 2][1] + 0.02);

  return thumbExtended && thumbUp && fingersClosed;
}

function detectOpenPalm(landmarks) {
  if (!landmarks) return false;

  const fingersUp = [8, 12, 16, 20].every((tip, i) => {
    const pip = [6, 10, 14, 18][i];
    return landmarks[tip][1] < landmarks[pip][1] - 0.03;
  });

  if (!fingersUp) return false;

  const spread = Math.abs(landmarks[20][0] - landmarks[4][0]);
  return spread > 0.12;
}

function classifyGesture(landmarks) {
  if (!landmarks) return null;

  if (detectThumbsUp(landmarks)) return 'thumbs_up';

  const fingers = countFingers(landmarks);

  if (fingers === 0) {
    if (detectOpenPalm(landmarks)) return 'open_palm';
    return 'fist';
  }

  const gestureNames = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five' };
  return gestureNames[fingers] || null;
}

// ─── Actions ─────────────────────────────────────────────────
function executeGestureAction(gesture) {
  if (state.lastAction === gesture && state.gestureCooldown > 0) return;

  state.gestureCooldown = CONFIG.GESTURE_COOLDOWN;
  state.lastAction = gesture;

  const actions = {
    one: () => {
      speak('Hello sir, Jarvis at your service. How may I assist you today?');
      addMessage('Hello sir, Jarvis at your service. How may I assist you today?', 'jarvis');
    },
    two: () => {
      const now = new Date();
      const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      speak(`The current time is ${time}`);
      addMessage(`Current time: ${time}`, 'jarvis');
    },
    three: () => {
      const now = new Date();
      const date = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      speak(`Today is ${date}`);
      addMessage(`Today is ${date}`, 'jarvis');
    },
    four: () => fetchWeather(),
    five: () => {
      speak('What should I search for?');
      addMessage('Search mode. What should I search for?', 'jarvis');
      startVoiceRecognition();
    },
    fist: () => cancelSpeech(),
    open_palm: () => {
      speak('Voice command mode activated.');
      addSystem('Voice command mode activated.');
      startVoiceRecognition();
    },
    thumbs_up: () => fetchJoke(),
    swipe_right: () => { addSystem('Swiped right'); speak('Moving forward.'); },
    swipe_left: () => { addSystem('Swiped left'); speak('Going back.'); },
    swipe_up: () => {
      CONFIG.SPEECH_RATE = Math.min(2.0, CONFIG.SPEECH_RATE + 0.1);
      speak(`Speech rate ${CONFIG.SPEECH_RATE.toFixed(1)}`);
    },
    swipe_down: () => {
      CONFIG.SPEECH_RATE = Math.max(0.3, CONFIG.SPEECH_RATE - 0.1);
      speak(`Speech rate ${CONFIG.SPEECH_RATE.toFixed(1)}`);
    },
  };

  const action = actions[gesture];
  if (action) {
    action();
    highlightGuide(gesture);
  }
}

function highlightGuide(gesture) {
  const map = {
    one: 0, two: 1, three: 2, four: 3, five: 4,
    fist: 5, swipe_right: 6, swipe_left: 7, thumbs_up: 8, open_palm: 9,
  };
  const idx = map[gesture];
  if (idx !== undefined) {
    const items = document.querySelectorAll('.guide-item');
    items.forEach((el, i) => el.classList.toggle('active', i === idx));
    setTimeout(() => items.forEach(el => el.classList.remove('active')), 1500);
  }
}

// ─── Weather ─────────────────────────────────────────────────
async function fetchWeather() {
  speak('Fetching weather data...');
  addMessage('Fetching weather...', 'jarvis');
  try {
    const resp = await fetch('https://api.open-meteo.com/v1/forecast?latitude=28.61&longitude=77.23&current_weather=true');
    const data = await resp.json();
    const w = data.current_weather;
    const desc = weatherCodeToString(w.weathercode);
    const msg = `Current weather: ${desc}, ${w.temperature}°C`;
    speak(msg);
    addMessage(msg, 'jarvis');
  } catch {
    const msg = 'Could not fetch weather. Check your connection.';
    speak(msg);
    addMessage(msg, 'jarvis');
  }
}

function weatherCodeToString(code) {
  const m = {
    0: 'clear', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
    45: 'foggy', 51: 'light drizzle', 61: 'rain', 71: 'snow',
    80: 'rain showers', 95: 'thunderstorm',
  };
  return m[code] || `code ${code}`;
}

// ─── Joke ────────────────────────────────────────────────────
async function fetchJoke() {
  speak('Finding a joke...');
  addMessage('Searching for a joke...', 'jarvis');
  try {
    const resp = await fetch('https://v2.jokeapi.dev/joke/Any?type=single');
    const data = await resp.json();
    const joke = data.joke || `${data.setup} ... ${data.delivery}`;
    speak(joke);
    addMessage(joke, 'jarvis');
  } catch {
    const joke = 'Why do programmers prefer dark mode? Because light attracts bugs!';
    speak(joke);
    addMessage(joke, 'jarvis');
  }
}

// ─── Backend Communication ──────────────────────────────────
const BACKEND_URL = `http://${location.host}`;

async function sendToBackend(text) {
  try {
    const resp = await fetch(`${BACKEND_URL}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return data.response;
  } catch (err) {
    return null;
  }
}

async function checkBackendStatus() {
  try {
    const resp = await fetch(`${BACKEND_URL}/api/status`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function saveConfig(config) {
  try {
    const resp = await fetch(`${BACKEND_URL}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return resp.ok ? await resp.json() : null;
  } catch {
    return null;
  }
}

async function loadConfig() {
  try {
    const resp = await fetch(`${BACKEND_URL}/api/config`);
    return resp.ok ? await resp.json() : null;
  } catch {
    return null;
  }
}

// ─── AI Status ──────────────────────────────────────────────
function updateAIStatus(status, text) {
  dom.aiDot.className = `ai-indicator ${status}`;
  dom.aiStatusText.textContent = text;
}

async function queryGroqDirect(prompt) {
  const apiKey = localStorage.getItem('groq_api_key');
  const model = localStorage.getItem('groq_model') || 'llama-3.1-8b-instant';
  if (!apiKey) return null;
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: 'You are Jarvis, a smart AI assistant. Respond in English concisely.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500,
        temperature: 0.7
      })
    });
    const data = await resp.json();
    return data.choices[0].message.content;
  } catch {
    return null;
  }
}

async function initAI() {
  const localKey = localStorage.getItem('groq_api_key');
  if (localKey) {
    state.ai.ready = true;
    state.ai.localMode = true;
    updateAIStatus('ready', 'AI: groq (browser)');
    return;
  }
  const status = await checkBackendStatus();
  if (status && status.has_key) {
    state.ai.ready = true;
    state.ai.localMode = false;
    updateAIStatus('ready', 'AI: ' + status.provider);
  } else {
    state.ai.ready = false;
    updateAIStatus('error', 'Set API key in Settings');
  }
}

async function processWithBackend(command) {
  updateStatus('Thinking...');
  addSystem('Processing...');

  const response = await sendToBackend(command);
  if (response) {
    speak(response);
    addMessage(response, 'jarvis');
    updateStatus('Waiting for gesture...');
    return;
  }

  const groqResp = await queryGroqDirect(command);
  if (groqResp) {
    speak(groqResp);
    addMessage(groqResp, 'jarvis');
    updateStatus('Waiting for gesture...');
    return;
  }

  const fallback = 'Backend not responding and no API key set. Configure AI in settings.';
  speak(fallback);
  addMessage(fallback, 'jarvis');
  updateStatus('Waiting for gesture...');
}

// ─── Voice Recognition ──────────────────────────────────────
const VOICE_LANGS = ['en-IN', 'hi-IN', 'en-US'];
let voiceLangIdx = 0;

function getVoiceLang() { return VOICE_LANGS[voiceLangIdx]; }

function toggleVoiceLang() {
  voiceLangIdx = (voiceLangIdx + 1) % VOICE_LANGS.length;
  const names = { 'hi-IN': 'Hinglish', 'en-IN': 'English (IN)', 'en-US': 'English (US)' };
  addSystem(`Voice: ${names[getVoiceLang()]}`);
}

function startVoiceRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    speak('Voice recognition not supported in this browser.');
    addSystem('Voice not supported in this browser.');
    return;
  }

  if (state.recognition) state.recognition.stop();

  state.recognition = new SR();
  state.recognition.continuous = false;
  state.recognition.interimResults = false;
  state.recognition.lang = getVoiceLang();
  state.recognition.maxAlternatives = 1;

  dom.voiceBtn.classList.add('listening');
  state.listening = true;
  updateStatus(`Listening (${getVoiceLang()})...`);
  addSystem(`Listening... speak in Hinglish/Hindi/English`);

  state.recognition.onresult = (event) => {
    const now = Date.now();
    if (now - state.voiceLastCmd < 2000) return;
    let text = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        text += event.results[i][0].transcript;
      }
    }
    text = text.trim();
    if (text && text.length > 1) {
      state.voiceLastCmd = now;
      addMessage(text, 'user');
      processVoiceCommand(text);
      setTimeout(() => stopListening(), 100);
    }
  };

  state.recognition.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') {
      stopListening();
      return;
    }
    addSystem(`Mic error: ${e.error}. Click mic again or type instead.`);
    stopListening();
  };

  state.recognition.onend = () => { };

  dom.voiceBtn.oncontextmenu = (e) => {
    e.preventDefault();
    toggleVoiceLang();
  };

  try { state.recognition.start(); } catch (e) { stopListening(); }
}

function stopListening() {
  dom.voiceBtn.classList.remove('listening');
  state.listening = false;
  if (state.recognition) {
    try { state.recognition.stop(); } catch (e) {}
  }
  if (!state.isTalking) updateStatus('Waiting for gesture...');
}

async function processVoiceCommand(command) {
  if (state.isProcessing) return;
  state.isProcessing = true;
  try {
    const lower = command.toLowerCase().trim();

    // Debounce: ignore same text within 3 seconds
    if (lower === state.voiceLastText && Date.now() - state.voiceLastCmd < 3000) return;
    state.voiceLastText = lower;
    state.voiceLastCmd = Date.now();

    // Hinglish / Hindi shortcuts
    if (lower.includes('time') || lower.includes('samay') || lower.includes('time kya') || lower.includes('baje')) {
      const now = new Date();
      const t = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      speak(`The time is ${t}`);
      addMessage(`Time: ${t}`, 'jarvis');
      return;
    }
    if (lower.includes('date') || lower.includes('day') || lower.includes('tarikh') || lower.includes('aaj')) {
      const now = new Date();
      const d = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      speak(`Today is ${d}`);
      addMessage(`Date: ${d}`, 'jarvis');
      return;
    }
    if (lower.includes('weather') || lower.includes('mausam')) {
      fetchWeather(); return;
    }
    if (lower.includes('joke') || lower.includes('chutkula') || lower.includes('funny') || lower.includes('mazaak')) {
      fetchJoke(); return;
    }
    if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey') || lower.includes('namaste')) {
      speak('Hello sir, how can I help you?');
      addMessage('Hello sir!', 'jarvis');
      return;
    }
    if (lower.includes('who are you') || lower.includes('kaun ho') || lower.includes('intro')) {
      speak('I am Jarvis, your AI-powered gesture-controlled assistant.');
      addMessage('I am Jarvis, your AI assistant.', 'jarvis');
      return;
    }
    if (lower.includes('thank') || lower.includes('shukriya') || lower.includes('thanks') || lower.includes('dhanyavaad')) {
      speak('You are welcome, sir.');
      addMessage('You are welcome!', 'jarvis');
      return;
    }
    if (lower.includes('stop') || lower.includes('silence') || lower.includes('shut up') || lower.includes('chup') || lower.includes('bas')) {
      cancelSpeech(); return;
    }

    // Open commands → normalize then send to backend
    if (/^(open|launch|start)\s+/i.test(command)) {
      await processWithBackend(command);
      return;
    }
    if (/kholo|khol|khole|khol do|khol de|kholi/i.test(command)) {
      const app = command.replace(/kholo|khol|khole|khol do|khol de|kholi/gi, '').trim();
      if (app) {
        await processWithBackend(`open ${app}`);
        return;
      }
    }

    // Fallback → AI backend
    await processWithBackend(command);
  } finally {
    state.isProcessing = false;
  }
}

// ─── Camera & Hand Tracking Setup ───────────────────────────
async function startCamera() {
  try {
    updateStatus('Requesting camera access...');
    addSystem('Requesting camera access...');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
    });
    dom.webcam.srcObject = stream;
    await dom.webcam.play();

    dom.canvas.width = 640;
    dom.canvas.height = 480;

    updateStatus('Camera active. Loading model...');
    addSystem('Camera active. Loading hand tracking model...');
    loadModel();
  } catch (err) {
    updateStatus('Camera access denied');
    addSystem('Camera access denied. Allow camera permission in browser and refresh.');
    console.error(err);
  }
}

async function loadModel() {
  try {
    state.model = await handpose.load();
    addSystem('Hand tracking model loaded.');
    updateStatus('Waiting for gesture...');
    speak('Hello sir, Jarvis is ready. Show me a hand gesture.', () => {
      state.isTalking = false;
      updateStatus('Waiting for gesture...');
    });
    detectLoop();
  } catch (err) {
    updateStatus('Model failed to load');
    addSystem('Failed to load hand tracking model. Check internet connection. You can still type commands.');
    console.error(err);
  }
}

// ─── Detection Loop ──────────────────────────────────────────
async function detectLoop() {
  const detect = async () => {
    if (dom.webcam.readyState >= 2) {
      try {
        const predictions = await state.model.estimateHands(dom.webcam);
        processPredictions(predictions);
      } catch (e) {
        // Silently handle frame errors
      }
    }
    requestAnimationFrame(detect);
  };
  detect();
}

function processPredictions(predictions) {
  dom.ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);

  const rawDetected = predictions && predictions.length > 0;
  let validHand = false;

  if (rawDetected) {
    const hand = predictions[0];
    const confidence = hand.handInViewConfidence;
    const box = hand.boundingBox;
    const boxW = box.bottomRight[0] - box.topLeft[0];
    const boxH = box.bottomRight[1] - box.topLeft[1];
    const boxArea = boxW * boxH;

    if (confidence >= 0.85 && boxArea > 8000 && boxW > 60 && boxH > 60) {
      validHand = true;
    }
  }

  if (validHand) {
    state.handStable = Math.min(state.handStable + 1, 10);
  } else {
    state.handStable = 0;
  }

  state.handDetected = state.handStable >= 3;

  dom.handStatus.textContent = state.handDetected
    ? `Hand detected`
    : 'No hand';
  dom.handStatus.className = `hand-status${state.handDetected ? ' detected' : ''}`;

  if (!state.handDetected) {
    state.swipeHistory = [];
    state.gestureStable = 0;
    state.prevGesture = null;
    if (!state.isTalking) {
      dom.gestureName.textContent = '--';
      dom.fingerCount.textContent = 'Show your hand';
    }
    return;
  }

  // Two hands → silence
  const hasTwoHands = predictions.length >= 2 &&
    predictions[1].handInViewConfidence >= 0.85;
  if (hasTwoHands) {
    state.twoHandStable++;
    if (state.twoHandStable >= 5 && !state.twoHandSilenced && state.isTalking) {
      state.twoHandSilenced = true;
      cancelSpeech();
      addSystem('Silent (two hands)');
    }
  } else {
    state.twoHandStable = 0;
    state.twoHandSilenced = false;
  }

  const hand = predictions[0];
  const landmarks = hand.landmarks;

  drawLandmarks(landmarks);

  const gesture = classifyGesture(landmarks);

  if (gesture) {
    dom.gestureName.textContent = gesture.replace('_', ' ').toUpperCase();
    dom.fingerCount.textContent = `Fingers: ${countFingers(landmarks)}`;

    if (gesture === state.prevGesture) {
      state.gestureStable++;
    } else {
      state.gestureStable = 0;
      state.prevGesture = gesture;
    }

    if (state.gestureCooldown > 0) state.gestureCooldown--;

    if (state.gestureStable >= CONFIG.GESTURE_STABILITY && state.gestureCooldown === 0 && !state.isTalking) {
      executeGestureAction(gesture);
      state.gestureStable = 0;
    }
  } else {
    dom.gestureName.textContent = 'UNKNOWN';
    state.gestureStable = 0;
  }

  if (predictions.length > 1) {
    const hand2 = predictions[1];
    if (hand2.handInViewConfidence >= 0.85) {
      drawLandmarks(hand2.landmarks);
    }
  }
}

// ─── Drawing ─────────────────────────────────────────────────
function drawLandmarks(landmarks) {
  const ctx = dom.ctx;
  const w = dom.canvas.width;
  const h = dom.canvas.height;

  const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17],
  ];

  ctx.strokeStyle = '#00d4ff';
  ctx.lineWidth = 2;

  for (const [i, j] of connections) {
    if (landmarks[i] && landmarks[j]) {
      ctx.beginPath();
      ctx.moveTo(landmarks[i][0] * w, landmarks[i][1] * h);
      ctx.lineTo(landmarks[j][0] * w, landmarks[j][1] * h);
      ctx.stroke();
    }
  }

  for (const lm of landmarks) {
    ctx.beginPath();
    ctx.arc(lm[0] * w, lm[1] * h, 4, 0, 2 * Math.PI);
    ctx.fillStyle = '#00d4ff';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (landmarks[0]) {
    ctx.beginPath();
    ctx.arc(landmarks[0][0] * w, landmarks[0][1] * h, 8, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffd70066';
    ctx.fill();
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// ─── Status ─────────────────────────────────────────────────
function updateStatus(text) {
  dom.statusText.textContent = text;
}

// ─── Input ───────────────────────────────────────────────────
function handleTextInput() {
  const text = dom.textInput.value.trim();
  if (!text) return;
  addMessage(text, 'user');
  dom.textInput.value = '';
  processVoiceCommand(text);
}

// ─── Settings Modal ─────────────────────────────────────────
function setupSettings() {
  const modal = document.getElementById('settings-modal');
  const openBtn = document.getElementById('settings-btn');
  const closeBtn = document.getElementById('modal-close');
  const saveBtn = document.getElementById('save-settings');
  const statusEl = document.getElementById('settings-status');

  openBtn.onclick = async () => {
    modal.style.display = 'flex';
    const localKey = localStorage.getItem('groq_api_key');
    const localModel = localStorage.getItem('groq_model');
    document.getElementById('api-key').value = localKey || '';
    document.getElementById('ai-model').value = localModel || 'llama-3.1-8b-instant';
    document.getElementById('ai-provider').value = 'groq';
    const cfg = await loadConfig();
    if (cfg && cfg.api_key && !localKey) {
      document.getElementById('api-key').value = cfg.api_key;
      document.getElementById('ai-model').value = cfg.model || cfg.api_key ? 'llama-3.1-8b-instant' : '';
    }
  };

  closeBtn.onclick = () => { modal.style.display = 'none'; };
  modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

  saveBtn.onclick = async () => {
    const config = {
      ai_provider: document.getElementById('ai-provider').value,
      api_key: document.getElementById('api-key').value,
      model: document.getElementById('ai-model').value || undefined,
    };
    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;
    statusEl.textContent = '';
    // Save to localStorage for phone use
    if (config.api_key) localStorage.setItem('groq_api_key', config.api_key);
    if (config.model) localStorage.setItem('groq_model', config.model);
    // Also try backend
    const result = await saveConfig(config);
    if (result || config.api_key) {
      statusEl.style.color = '#22c55e';
      statusEl.textContent = 'Saved! Testing...';
      await initAI();
      setTimeout(() => {
        statusEl.textContent = 'Ready';
        saveBtn.textContent = 'Save & Test';
        saveBtn.disabled = false;
        setTimeout(() => { statusEl.textContent = ''; modal.style.display = 'none'; }, 1000);
      }, 500);
    } else {
      statusEl.style.color = '#ef4444';
      statusEl.textContent = 'Saved locally (no backend)';
      await initAI();
      setTimeout(() => {
        saveBtn.textContent = 'Save & Test';
        saveBtn.disabled = false;
        setTimeout(() => { statusEl.textContent = ''; modal.style.display = 'none'; }, 1000);
      }, 500);
    }
  };
}

// ─── Init ────────────────────────────────────────────────────
function init() {
  initDOM();

  dom.launchBtn.addEventListener('click', launchApp);

  dom.sendBtn.addEventListener('click', handleTextInput);
  dom.textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleTextInput();
  });
  dom.voiceBtn.addEventListener('click', startVoiceRecognition);
}

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('load', () => window.speechSynthesis.getVoices());
