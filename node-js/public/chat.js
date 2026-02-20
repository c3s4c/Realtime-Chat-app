const wsStatus = document.getElementById('wsStatus');
const conversationsEl = document.getElementById('conversations');
const usersEl = document.getElementById('users');
const messagesEl = document.getElementById('messages');
const form = document.getElementById('chatForm');
const input = document.getElementById('messageInput');
const replyBox = document.getElementById('replyBox');

let ws;
let currentConversationId = null;
let replyTo = null;
let messages = [];

function setStatus(state) {
  wsStatus.className = `status ${state}`;
  wsStatus.textContent = state === 'connected' ? 'متصل' : state === 'connecting' ? 'درحال اتصال...' : 'قطع';
}

async function api(url, options) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (res.headers.get('content-type')?.includes('application/json')) return res.json();
  return null;
}

function renderMessages() {
  messagesEl.innerHTML = '';
  messages.forEach((m) => {
    const d = document.createElement('div');
    d.className = `msg ${m.sender_id === window.APP_USER.id ? 'me' : 'other'}`;
    d.dataset.id = m.id;
    if (m.reply_to_id) {
      const rp = messages.find((x) => x.id === m.reply_to_id);
      const p = document.createElement('div');
      p.className = 'reply-preview';
      p.textContent = rp ? rp.body : m.reply_body || 'Reply';
      d.appendChild(p);
    }
    const body = document.createElement('div');
    body.textContent = m.body;
    d.appendChild(body);

    let startX = null;
    d.addEventListener('touchstart', (e) => { startX = e.changedTouches[0].screenX; });
    d.addEventListener('touchend', (e) => {
      const delta = e.changedTouches[0].screenX - startX;
      if (Math.abs(delta) > 60) {
        replyTo = m;
        replyBox.classList.remove('hidden');
        replyBox.textContent = `Reply to: ${m.body}`;
      }
    });
    messagesEl.appendChild(d);
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function loadConversations() {
  const conversations = await api('/api/conversations');
  conversationsEl.innerHTML = '';
  conversations.forEach((c) => {
    const btn = document.createElement('button');
    btn.textContent = `${c.name} ${c.is_group ? '👥' : ''}`;
    btn.onclick = async () => {
      currentConversationId = c.id;
      messages = await api(`/api/conversations/${c.id}/messages`);
      renderMessages();
    };
    conversationsEl.appendChild(btn);
  });
}

async function loadUsers() {
  const users = await api('/api/users');
  usersEl.innerHTML = '';
  users.forEach((u) => {
    const btn = document.createElement('button');
    btn.textContent = `${u.first_name} ${u.last_name}`;
    btn.onclick = async () => {
      const convo = await api(`/api/conversations/direct/${u.id}`, { method: 'POST' });
      currentConversationId = convo.id;
      await loadConversations();
      messages = await api(`/api/conversations/${convo.id}/messages`);
      renderMessages();
    };
    usersEl.appendChild(btn);
  });
}

function connectWs() {
  setStatus('connecting');
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => setStatus('connected');
  ws.onclose = () => {
    setStatus('disconnected');
    setTimeout(connectWs, 2000);
  };
  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'new_message' && data.message.conversation_id === currentConversationId) {
      messages.push(data.message);
      renderMessages();
    }
  };
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!currentConversationId || !input.value.trim() || ws.readyState !== 1) return;
  ws.send(JSON.stringify({
    type: 'send_message',
    conversationId: currentConversationId,
    body: input.value,
    replyToId: replyTo?.id || null
  }));
  input.value = '';
  replyTo = null;
  replyBox.classList.add('hidden');
});

(async function init() {
  await loadConversations();
  await loadUsers();
  connectWs();
})();
