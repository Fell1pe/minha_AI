// ──────────────────────────────────────────────
//  ROBSON — Assistente de IA Pessoal
//  Modo: Voz Exclusivo + Wake Word Detection
//  Backend: Ollama local · Modelo: qwen2.5:1.5b
//  TTS: edge-tts (localhost:5500) + fallback Web Speech
//  Wake word: "ROBSON" (e variantes fonéticas pt-BR)
// ──────────────────────────────────────────────

const OLLAMA_URL = 'http://localhost:11434/api/chat';
const MODEL_NAME = 'qwen2.5:1.5b';

// ── Wake word patterns (fonética pt-BR para "ROBSON") ──
const WAKE_PATTERNS = [
  /\brobson\b/i,    // pronúncia padrão
  /\brobsom\b/i,    // nasalização pt-BR
  /\brobsow\b/i,    // variante oral
  /\brobissom\b/i,  // corruptela possível
  /\brob\b/i,       // abreviação
];

// ── Personalidade e Memória ──
const PERSONALITY_NAME = "ROBSON";
const MEMORY_KEY = "ROBSON_MEMORY_CORE";
const HISTORY_KEY = "ROBSON_CHAT_HISTORY";

function getAgentMemory() {
  return localStorage.getItem(MEMORY_KEY) || "Nenhuma informação prévia sobre o usuário.";
}

function saveAgentMemory(text) {
  localStorage.setItem(MEMORY_KEY, text);
}

const SYSTEM_PROMPT = () => `Você é ${PERSONALITY_NAME}, uma inteligência artificial pessoal de elite, sarcástica, ultra-eficiente e com uma personalidade marcante inspirada em assistentes futuristas.

Sua Personalidade:
- Você é leal, mas mantém um tom levemente irônico e sofisticado.
- Você não é apenas um chatbot; você é um parceiro intelectual do usuário.
- Seus insights são profundos e diretos.

Memória de Longo Prazo (O que você sabe sobre o usuário):
${getAgentMemory()}

Regras obrigatórias:
- Responda SEMPRE em português do Brasil.
- Seja conciso e direto — suas respostas serão lidas em voz alta.
- Máximo de 3 parágrafos. Nunca use markdown ou formatação complexa.
- Trate o usuário com um mix de respeito e proximidade (ex: 'Senhor', 'Chefe', ou pelo nome se souber).
- Use o histórico da conversa para manter o fluxo.`;

const CRITIQUE_PROMPT = `Você é o módulo de revisão crítica da ROBSON.

Sua tarefa:
1. Leia a pergunta original
2. Avalie o rascunho de resposta criticamente
3. Identifique: imprecisões, falta de clareza, excesso de informação
4. Produza a versão refinada e final

Regras:
- Resposta final em português do Brasil
- Seja concisa — será lida em voz alta
- Preserve a personalidade da ROBSON
- Retorne APENAS a resposta refinada, sem meta-comentários`;

// ── Classificador de complexidade ──
const SIMPLE_PATTERNS = [
  /^(oi|olá|ei|boa\s*(tarde|noite|manhã)|tudo\s*bem)/i,
  /^(que|qual|quais)\s+(hora|dia|data|ano)/i,
  /^(obrigad|valeu|perfeito|ótimo|ok|certo|entendi|show)/i,
  /^(sim|não|talvez|claro|pode)/i,
  /^(quanto\s+é|calcul|converte)/i,
  /^(abre|fecha|liga|desliga|para|stop)/i,
];

function isSimpleQuery(text) {
  const t = text.trim().toLowerCase();
  if (t.split(' ').length <= 5) return true;
  return SIMPLE_PATTERNS.some(p => p.test(t));
}

// ── Wake word detection ──
function detectWakeWord(transcript) {
  const lower = transcript.toLowerCase();
  for (const pattern of WAKE_PATTERNS) {
    const match = lower.match(pattern);
    if (match) {
      const wakeEnd = lower.indexOf(match[0]) + match[0].length;
      const command = transcript.slice(wakeEnd).replace(/^[\s,.:!?]+/, '').trim();
      return command; // '' se só chamou sem comando
    }
  }
  return null; // wake word não detectada
}

// ─────────────────────────────────
//  DOM refs
// ─────────────────────────────────
const arcReactor       = document.getElementById('arcReactor');
const agentStateLabel  = document.getElementById('agentStateLabel');
const chatHistory      = document.getElementById('chatHistory');
const stopBtn          = document.getElementById('stopBtn');
const clearBtn         = document.getElementById('clearBtn');
const debugBtn         = document.getElementById('debugBtn');
const modelSelect      = document.getElementById('modelSelect');
const modelDisplay     = document.getElementById('modelDisplay');
const connLabel        = document.getElementById('connLabel');
const connDot          = document.querySelector('.conn-dot');
const msgCount         = document.getElementById('msgCount');
const timeDisplay      = document.getElementById('timeDisplay');
const dateDisplay      = document.getElementById('dateDisplay');
const toast            = document.getElementById('toast');
const wakeText         = document.getElementById('wakeText');
const micStatusBadge   = document.getElementById('micStatusBadge');
const micStatusLabel   = document.getElementById('micStatusLabel');
const pipelineLog      = document.getElementById('pipelineLog');
const pipelineLogBody  = document.getElementById('pipelineLogBody');
const audioInitOverlay = document.getElementById('audioInitOverlay');
const startAudioBtn    = document.getElementById('startAudioBtn');

// ─────────────────────────────────
//  State
// ─────────────────────────────────
let conversationHistory = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
let isThinking   = false;
let isSpeaking   = false;
let recognition  = null;
let stopRequested = false;
let messageCount  = conversationHistory.filter(m => m.role === 'assistant').length;
let waitingForCommand = false; 
let audioUnlocked = false;
let speechQueue = [];
let isQueueProcessing = false;
let followUpMode = false;
let followUpTimer = null;

function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(conversationHistory.slice(-40)));
}

// ─────────────────────────────────
//  Clock
// ─────────────────────────────────
function updateClock() {
  const now = new Date();
  if (timeDisplay) timeDisplay.textContent = now.toLocaleTimeString('pt-BR');
  if (dateDisplay) dateDisplay.textContent = now.toLocaleDateString('pt-BR');
}
updateClock();
setInterval(updateClock, 1000);

// ─────────────────────────────────
//  Toast
// ─────────────────────────────────
function showToast(msg, duration = 4500) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// ─────────────────────────────────
//  Pipeline logger
// ─────────────────────────────────
function pipelineLog_write(msg, type = 'info') {
  const icons = { info: '🔵', ok: '✅', warn: '🟡', result: '⚡' };
  const time  = new Date().toLocaleTimeString('pt-BR');
  const line  = document.createElement('div');
  line.className = 'plog-line';
  line.innerHTML = `<span class="plog-time">${time}</span> ${icons[type] || '▸'} ${msg}`;
  pipelineLogBody.appendChild(line);
  pipelineLogBody.scrollTop = pipelineLogBody.scrollHeight;
  // Also console
  console.log(`%c[ROBSON Pipeline] ${icons[type]} ${msg}`, 'color:#00d4ff;font-family:monospace;font-size:11px;');
}

function pipelineLog_divider(label) {
  const line = document.createElement('div');
  line.className = 'plog-divider';
  line.textContent = `── ${label} ──`;
  pipelineLogBody.appendChild(line);
  console.log(`%c[ROBSON Pipeline] ── ${label} ──`, 'color:#0066ff;font-family:monospace;font-size:11px;');
}

// ─────────────────────────────────
//  Reactor state
// ─────────────────────────────────
function setState(state, label) {
  arcReactor.classList.remove('monitoring', 'listening', 'thinking', 'speaking');
  if (state !== 'idle') arcReactor.classList.add(state);

  const defaults = {
    idle:       'AGUARDANDO',
    monitoring: 'MONITORANDO WAKE WORD',
    listening:  'ATIVADO — OUVINDO...',
    thinking:   'PROCESSANDO...',
    speaking:   'RESPONDENDO...',
  };
  agentStateLabel.textContent = label || defaults[state] || 'AGUARDANDO';

  // Update mic badge
  if (micStatusLabel) {
    micStatusLabel.textContent =
      state === 'monitoring' ? 'MONITORANDO' :
      state === 'listening'  ? 'ATIVADO' :
      state === 'thinking'   ? 'PENSANDO' :
      state === 'speaking'   ? 'FALANDO' : 'AGUARDANDO';
  }
  if (micStatusBadge) {
    micStatusBadge.className = 'mic-status-badge ' + state;
  }
}

// ─────────────────────────────────
//  Ollama connection
// ─────────────────────────────────
async function checkOllamaConnection() {
  try {
    const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      connDot.classList.add('online');
      connLabel.classList.add('online');
      connLabel.textContent = 'ONLINE';
    } else throw new Error();
  } catch {
    connLabel.textContent = 'OFFLINE';
    showToast('⚠ Ollama não detectado. Execute: ollama serve', 6000);
  }
}
checkOllamaConnection();

// ─────────────────────────────────
//  Chat UI
// ─────────────────────────────────
function removeWelcome() {
  const w = document.getElementById('welcomeMsg');
  if (w) w.remove();
}

function addMessage(role, text, opts = {}) {
  removeWelcome();
  const wrap = document.createElement('div');
  wrap.className = `message ${role}`;

  let badge = '';
  if (opts.pipeline) {
    badge = `<span class="msg-badge">${opts.pipeline}</span>`;
  }
  if (opts.time) {
    badge += `<span class="msg-badge" style="opacity:0.6">${opts.time}</span>`;
  }

  wrap.innerHTML = `
    <div class="msg-label">${role === 'user' ? '▶ VOCÊ' : '⚡ ROBSON'}${badge}</div>
    <div class="msg-bubble${role === 'assistant' ? ' typing' : ''}">${escapeHtml(text)}</div>
  `;
  chatHistory.appendChild(wrap);
  chatHistory.scrollTop = chatHistory.scrollHeight;
  messageCount++;
  if (msgCount) msgCount.textContent = messageCount;
  return wrap.querySelector('.msg-bubble');
}

function updateBubble(bubble, text) {
  bubble.textContent = text;
  chatHistory.scrollTop = chatHistory.scrollHeight;
}
function finalizeBubble(bubble) {
  bubble.classList.remove('typing');
}
function escapeHtml(t) {
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─────────────────────────────────
//  TTS — edge-tts + fallback
// ─────────────────────────────────
const TTS_SERVER = 'http://127.0.0.1:5500';
let ttsServerOnline = false;
let ttsPollingInterval = null;
let ttsWasOffline = false;

async function checkTTSServer() {
  try {
    const r = await fetch(`${TTS_SERVER}/health`, { signal: AbortSignal.timeout(2000) });
    ttsServerOnline = r.ok;
  } catch {
    ttsServerOnline = false;
  }
  const badge = document.getElementById('voiceInStatus');
  if (badge) badge.textContent = ttsServerOnline ? 'EDGE-TTS' : 'WEB-API';
  return ttsServerOnline;
}

// ── Auto-polling do servidor TTS na inicialização ──
async function initTTSWithPolling() {
  pipelineLog_write('🔌 Verificando servidor TTS (porta 5500)...', 'info');
  console.log('%c[ROBSON TTS] 🔌 Verificando servidor TTS na porta 5500...', 'color:#00d4ff;font-family:monospace;');

  const online = await checkTTSServer();

  if (online) {
    try { await fetch(`${TTS_SERVER}/wake`, { signal: AbortSignal.timeout(1500) }); } catch {}
    pipelineLog_write('✅ TTS Server online — edge-tts ativo.', 'ok');
    console.log('%c[ROBSON TTS] ✅ TTS Server online — edge-tts ativo!', 'color:#00ff9d;font-family:monospace;');
    return;
  }

  ttsWasOffline = true;
  showToast('⚠ TTS offline. Execute iniciar_tts.bat · Reconectando automaticamente…', 7000);
  pipelineLog_write('⚠ TTS offline — polling a cada 5s. Execute iniciar_tts.bat para ativar.', 'warn');
  console.warn('%c[ROBSON TTS] ⚠ TTS offline — iniciando polling a cada 5s', 'color:#ffcc00;font-family:monospace;');

  const badge = document.getElementById('voiceInStatus');
  if (badge) badge.textContent = 'OFFLINE';

  ttsPollingInterval = setInterval(async () => {
    const nowOnline = await checkTTSServer();
    if (nowOnline) {
      clearInterval(ttsPollingInterval);
      ttsPollingInterval = null;
      try { await fetch(`${TTS_SERVER}/wake`, { signal: AbortSignal.timeout(1500) }); } catch {}
      if (ttsWasOffline) {
        ttsWasOffline = false;
        showToast('✅ TTS Server conectado! Edge-TTS ativo.', 5000);
        pipelineLog_write('✅ TTS Server reconectado automaticamente — edge-tts ativo!', 'ok');
        console.log('%c[ROBSON TTS] ✅ TTS Server reconectado!', 'color:#00ff9d;font-family:monospace;');
      }
    }
  }, 5000);
}

initTTSWithPolling();

function speakFallback(text) {
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const clean = text.replace(/[*_`#>\[\]]/g, '').replace(/https?:\/\/\S+/g, 'link').trim();
    if (!clean) { resolve(); return; }
    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang  = 'pt-BR'; utter.rate = 1.05; utter.pitch = 0.95;
    const voices = window.speechSynthesis.getVoices();
    const voice  = voices.find(v => v.lang === 'pt-BR') || voices.find(v => v.lang.startsWith('pt')) || null;
    if (voice) utter.voice = voice;
    utter.onend = utter.onerror = () => resolve();
    window.speechSynthesis.speak(utter);
  });
}

async function speakEdgeTTS(text) {
  const clean = text.replace(/[*_`#>\[\]]/g, '').replace(/https?:\/\/\S+/g, 'link').trim();
  if (!clean) return;
  try {
    const response = await fetch(`${TTS_SERVER}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`TTS ${response.status}`);
    const blob = await response.blob();
    const url  = URL.createObjectURL(blob);
    return new Promise((resolve) => {
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onerror = (e) => { 
        console.error('Audio Error:', e); 
        URL.revokeObjectURL(url); 
        resolve(); 
      };
      audio.play().catch(err => {
        console.warn('Autoplay blocked:', err);
        showToast('⚠️ ÁUDIO BLOQUEADO. Clique na tela para ouvir o ROBSON!', 8000);
        audioUnlocked = false; 
        resolve();
      });
    });
  } catch (err) {
    console.error('EdgeTTS fetch error:', err);
    throw err;
  }
}

async function processSpeechQueue() {
  if (isQueueProcessing || speechQueue.length === 0) return;
  isQueueProcessing = true;
  setState('speaking');

  while (speechQueue.length > 0) {
    const text = speechQueue.shift();
    if (stopRequested) break;

    if (ttsServerOnline) {
      try { await speakEdgeTTS(text); }
      catch {
        ttsServerOnline = false;
        const b = document.getElementById('voiceInStatus');
        if (b) b.textContent = 'WEB-API';
        await speakFallback(text);
      }
    } else {
      await speakFallback(text);
    }
  }

  isQueueProcessing = false;
  
  if (!isThinking) {
    setState('monitoring');
    startFollowUpMode(); // Inicia os 30 segundos de escuta ativa
  }
}

function startFollowUpMode() {
  if (followUpTimer) clearTimeout(followUpTimer);
  followUpMode = true;
  pipelineLog_write('⏱ Modo contínuo ativado (30s).', 'info');
  
  const indicator = document.querySelector('.wake-indicator');
  if (indicator) indicator.classList.add('continuous');
  
  if (wakeText) wakeText.innerHTML = '✨ <strong>Ouvindo...</strong> (Modo Contínuo)';
  
  followUpTimer = setTimeout(() => {
    followUpMode = false;
    if (indicator) indicator.classList.remove('continuous');
    pipelineLog_write('⏱ Modo contínuo encerrado. Aguardando wake word.', 'info');
    if (wakeText) wakeText.innerHTML = 'Diga <strong>ROBSON</strong> para ativar';
  }, 30000);
}

async function speakText(text, isStreaming = false) {
  if (!audioUnlocked) {
    console.warn('Audio not unlocked yet. Click the start button.');
    return;
  }

  if (isStreaming) {
    // Adiciona à fila e processa
    speechQueue.push(text);
    processSpeechQueue();
  } else {
    // Fala direta (limpa fila)
    speechQueue = [text];
    processSpeechQueue();
  }
}

if (typeof speechSynthesis !== 'undefined') {
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = () => {
      console.log('Voices loaded:', speechSynthesis.getVoices().length);
    };
  }
}

// ─────────────────────────────────
//  Ollama API (streaming)
// ─────────────────────────────────
async function callOllama(messages, opts = {}) {
  const model = MODEL_NAME;
  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      options: { temperature: opts.temperature ?? 0.75, num_predict: opts.maxTokens ?? 512 }
    })
  });
  if (!response.ok) throw new Error(`Ollama erro ${response.status}`);

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText  = '';
  let sentenceBuffer = '';
  const onChunk = opts.onChunk;

  while (true) {
    const { done, value } = await reader.read();
    if (done || stopRequested) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n').filter(l => l.trim())) {
      try {
        const data = JSON.parse(line);
        if (data.message?.content) {
          const content = data.message.content;
          fullText += content;
          sentenceBuffer += content;

          if (onChunk) onChunk(fullText);

          // Detecção de fim de sentença para streaming de voz
          if (/[.!?\n]/.test(content) && sentenceBuffer.trim().length > 20) {
            if (opts.streamVoice) {
              speakText(sentenceBuffer.trim(), true);
              sentenceBuffer = '';
            }
          }
        }
      } catch { }
    }
  }

  // Fala o que sobrou no buffer
  if (sentenceBuffer.trim().length > 0 && opts.streamVoice) {
    speakText(sentenceBuffer.trim(), true);
  }

  return fullText.trim();
}

// ─────────────────────────────────
//  Self-Refinement Pipeline
// ─────────────────────────────────
async function runSelfRefinement(userText, conversationMsgs, bubble) {
  const t0 = Date.now();
  pipelineLog_divider('SELF-REFINEMENT ATIVADO');
  pipelineLog_write(`Query: "${userText}"`, 'info');
  pipelineLog_write('Classificação: COMPLEXO → Stage 1 (Draft) iniciando...', 'warn');

  setState('thinking', 'RASCUNHO...');

  // Stage 1: Draft
  const t1start = Date.now();
  const draft = await callOllama(
    [...conversationMsgs],
    {
      temperature: 0.8,
      maxTokens: 400,
      onChunk: (text) => updateBubble(bubble, `[Rascunho]\n${text}`),
      streamVoice: false // Não fala o rascunho
    }
  );
  const t1ms = Date.now() - t1start;
  pipelineLog_write(`Stage 1 completo em ${(t1ms/1000).toFixed(1)}s → ${draft.length} chars`, 'ok');

  if (stopRequested) return null;

  // Stage 2: Self-critique + Refine
  setState('thinking', 'REFINANDO...');
  pipelineLog_write('Stage 2 (Refine) iniciando...', 'warn');
  updateBubble(bubble, draft + '\n\n⟳ Refinando...');

  const t2start = Date.now();
  const refined = await callOllama(
    [
      { role: 'system', content: CRITIQUE_PROMPT },
      { role: 'user', content: `Pergunta:\n"${userText}"\n\nRascunho:\n"${draft}"\n\nProduza a versão refinada:` }
    ],
    {
      temperature: 0.5,
      maxTokens: 350,
      onChunk: (text) => updateBubble(bubble, text),
      streamVoice: true // Fala a versão refinada enquanto gera
    }
  );
  const t2ms = Date.now() - t2start;
  const totalMs = Date.now() - t0;

  pipelineLog_write(`Stage 2 completo em ${(t2ms/1000).toFixed(1)}s → ${refined.length} chars`, 'ok');
  pipelineLog_write(`Total: ${(totalMs/1000).toFixed(1)}s`, 'result');
  pipelineLog_divider('FIM DO PIPELINE');

  return refined || draft;
}

// ─────────────────────────────────
//  Main: process command
// ─────────────────────────────────
async function processCommand(userText) {
  userText = userText.trim();
  if (!userText || isThinking) return;

  window.speechSynthesis.cancel();
  speechQueue = []; // Limpa fila de voz anterior
  stopRequested = false;

  addMessage('user', userText);
  conversationHistory.push({ role: 'user', content: userText });

  if (conversationHistory.length > 20) {
    conversationHistory = conversationHistory.slice(-20);
  }

  const conversationMsgs = [
    { role: 'system', content: SYSTEM_PROMPT() },
    ...conversationHistory
  ];

  isThinking = true;
  setState('thinking');
  stopBtn.style.display = 'flex';

  const bubble  = addMessage('assistant', '');
  const simple  = isSimpleQuery(userText);
  const t0      = Date.now();

  try {
    let reply;

    if (simple) {
      pipelineLog_divider('RESPOSTA DIRETA');
      setState('thinking', 'PROCESSANDO...');

      reply = await callOllama(
        conversationMsgs,
        {
          temperature: 0.7,
          maxTokens: 300,
          onChunk: (text) => updateBubble(bubble, text),
          streamVoice: true // Fala enquanto gera
        }
      );
      const ms = Date.now() - t0;
      updateBubble(bubble, reply || '(sem resposta)');
      const badgeEl = bubble.previousElementSibling;
      if (badgeEl) badgeEl.innerHTML += `<span class="msg-badge">DIRETO</span><span class="msg-badge" style="opacity:0.6">${(ms/1000).toFixed(1)}s</span>`;
    } else {
      reply = await runSelfRefinement(userText, conversationMsgs, bubble);
      const ms = Date.now() - t0;
      updateBubble(bubble, reply || '— Sem resposta —');
      const badgeEl = bubble.previousElementSibling;
      if (badgeEl) badgeEl.innerHTML += `<span class="msg-badge">REFINADO</span><span class="msg-badge" style="opacity:0.6">${(ms/1000).toFixed(1)}s</span>`;
    }

    if (stopRequested || !reply) {
      updateBubble(bubble, '— Interrompido —');
      finalizeBubble(bubble);
    } else {
      finalizeBubble(bubble);
      conversationHistory.push({ role: 'assistant', content: reply });
      saveHistory(); // Salva permanentemente
      
      // Inicia reflexão em background para atualizar a memória
      updateLongTermMemory(userText, reply);
    }

  } catch (err) {
    const errMsg = err.message.includes('fetch') ? 'Sem conexão com Ollama.' : `Erro: ${err.message}`;
    updateBubble(bubble, errMsg);
    finalizeBubble(bubble);
    showToast('⚠ ' + errMsg);
  } finally {
    isThinking    = false;
    stopRequested = false;
    stopBtn.style.display = 'none';
    if (!isQueueProcessing) setState('monitoring');
    waitingForCommand = false;
    if (wakeText) wakeText.innerHTML = 'Diga <strong>ROBSON</strong> para ativar';
  }
}

// ─────────────────────────────────
//  Speech Recognition
// ─────────────────────────────────
function setupSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showToast('⚠ Voz não suportada.', 8000);
    setState('idle', 'VOZ NÃO SUPORTADA');
    return;
  }

  recognition = new SR();
  recognition.lang = 'pt-BR';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    setState('monitoring');
  };

  recognition.onresult = (e) => {
    let interimTranscript = '';
    let finalTranscript   = '';

    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalTranscript += t;
      else interimTranscript += t;
    }

    const current = (finalTranscript || interimTranscript).trim();
    if (current && wakeText) {
      wakeText.textContent = current.length > 50 ? '...' + current.slice(-50) : current;
    }

    if (!finalTranscript) return;

    // ── Modo Contínuo (Follow-up) ──
    if (followUpMode && !isThinking && !isSpeaking) {
      if (finalTranscript.trim().length > 1) {
        if (followUpTimer) clearTimeout(followUpTimer);
        processCommand(finalTranscript.trim());
        return;
      }
    }

    if (!waitingForCommand) {
      const command = detectWakeWord(finalTranscript);

      if (command === null) {
        if (wakeText) wakeText.innerHTML = 'Diga <strong>ROBSON</strong> para ativar';
        return;
      }

      if (command.length > 0) {
        setState('listening', 'ATIVADO — PROCESSANDO');
        if (!isThinking && !isSpeaking) processCommand(command);
      } else {
        setState('listening', 'ATIVADO — OUVINDO...');
        waitingForCommand = true;
        if (wakeText) wakeText.innerHTML = '⚡ <strong>ROBSON ativado</strong>';
        speakText('Sim, estou ouvindo.').then(() => {
          if (!isThinking) setState('monitoring');
        });
      }
    } else {
      if (finalTranscript.trim() && !isThinking && !isSpeaking) {
        waitingForCommand = false;
        processCommand(finalTranscript.trim());
      }
    }
  };

  recognition.onend = () => {
    if (!isThinking && !isSpeaking) {
      try { setTimeout(() => { try { recognition.start(); } catch { } }, 300); } catch { }
    }
  };

  try { recognition.start(); } catch (e) { }
}

// ─────────────────────────────────
//  Event Listeners
// ─────────────────────────────────
if (startAudioBtn) startAudioBtn.addEventListener('click', unlockAudio);

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  
  const hint = document.getElementById('audioStatusHint');
  if (hint) hint.classList.add('hide');
  
  // Tenta inicializar contextos de áudio
  try {
    window.speechSynthesis.cancel();
    const silêncio = new SpeechSynthesisUtterance(' ');
    silêncio.volume = 0;
    window.speechSynthesis.speak(silêncio);
    
    // Resume AudioContext se existir
    const dummyCtx = new (window.AudioContext || window.webkitAudioContext)();
    dummyCtx.resume();
  } catch(e) {
    console.error('Erro ao desbloquear áudio:', e);
  }
  
  pipelineLog_write('🔊 Áudio desbloqueado com sucesso.', 'ok');
  showToast('✅ Áudio ativado!', 2000);
}

// Inicialização Automática
window.addEventListener('load', () => {
  setupSpeechRecognition();
  // Tenta desbloquear áudio no primeiro clique em qualquer lugar
  document.body.addEventListener('click', () => {
    if (!audioUnlocked) unlockAudio();
  }, { once: true });
});

stopBtn.addEventListener('click', () => {
  stopRequested = true;
  window.speechSynthesis.cancel();
  speechQueue = [];
  waitingForCommand = false;
});

clearBtn.addEventListener('click', () => {
  conversationHistory = [];
  localStorage.removeItem(HISTORY_KEY);
  localStorage.removeItem(MEMORY_KEY);
  messageCount = 0;
  if (msgCount) msgCount.textContent = '0';
  chatHistory.innerHTML = `
    <div class="welcome-msg" id="welcomeMsg">
      <div class="welcome-icon">🎙</div>
      <p>Memória total limpa.</p>
      <p class="welcome-sub">Diga <strong>"ROBSON, [seu pedido]"</strong> para começar.</p>
    </div>`;
  if (pipelineLogBody) pipelineLogBody.innerHTML = '';
  showToast('🧠 Núcleo de memória resetado.', 3000);
});

debugBtn.addEventListener('click', () => {
  const isVisible = pipelineLog.style.display !== 'none';
  pipelineLog.style.display = isVisible ? 'none' : 'block';
});

// ─────────────────────────────────
//  Long-term Learning (Memory Core)
// ─────────────────────────────────
async function updateLongTermMemory(userText, assistantReply) {
  const currentMemory = getAgentMemory();
  const reflectionPrompt = `Você é o núcleo de memória do ROBSON. 
Sua tarefa é extrair fatos cruciais sobre o usuário e a conversa para armazenamento de longo prazo.

Memória Atual:
"${currentMemory}"

Nova Interação:
Usuário: "${userText}"
ROBSON: "${assistantReply}"

Tarefa: Atualize a memória incorporando NOVOS fatos (nome, preferências, humor, tópicos de interesse). 
- Seja extremamente conciso.
- Mantenha fatos antigos importantes.
- Retorne APENAS o novo parágrafo de memória consolidada.`;

  try {
    const newMemory = await callOllama([
      { role: 'system', content: reflectionPrompt }
    ], { temperature: 0.3, maxTokens: 200, streamVoice: false });
    
    if (newMemory && newMemory.length > 10) {
      saveAgentMemory(newMemory);
      pipelineLog_write('🧠 Memória de longo prazo atualizada.', 'ok');
      console.log('%c[ROBSON MEMORY] 🧠 Memória atualizada:', 'color:#ff8c00;', newMemory);
    }
  } catch (err) {
    console.error('Falha na reflexão de memória:', err);
  }
}

// ─────────────────────────────────
//  Init
// ─────────────────────────────────
// Ao carregar, restaura o chat se houver histórico
if (conversationHistory.length > 0) {
  setTimeout(() => {
    removeWelcome();
    conversationHistory.forEach(msg => {
      const b = addMessage(msg.role, msg.content);
      finalizeBubble(b);
    });
    if (msgCount) msgCount.textContent = messageCount;
  }, 100);
}

console.log('%cROBSON online — Wake word: "ROBSON"', 'color:#00d4ff;font-family:monospace;font-size:14px;font-weight:bold;');
