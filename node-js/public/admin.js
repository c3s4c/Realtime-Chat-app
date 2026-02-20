async function api(url, options) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  return res.json();
}

async function loadUsers() {
  const users = await api('/api/users');
  const wrap = document.getElementById('usersTable');
  wrap.innerHTML = users.map((u) => `<div>#${u.id} ${u.first_name} ${u.last_name} (${u.email}) admin:${u.is_admin} active:${u.is_active}
    <button onclick="removeUser(${u.id})">Delete</button></div>`).join('');
}

window.removeUser = async (id) => {
  await api(`/api/admin/users/${id}`, { method: 'DELETE' });
  loadUsers();
};

document.getElementById('addUser').onclick = async () => {
  const [first_name, last_name, email, password, is_admin] = document.getElementById('newUser').value.split(',').map((x) => x.trim());
  await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ first_name, last_name, email, password, is_admin: is_admin === '1' }) });
  loadUsers();
};

document.getElementById('createGroup').onclick = async () => {
  const name = document.getElementById('groupName').value;
  const memberIds = document.getElementById('groupMembers').value.split(',').map((x) => Number(x.trim())).filter(Boolean);
  await api('/api/admin/groups', { method: 'POST', body: JSON.stringify({ name, memberIds }) });
  alert('Group created');
};

document.getElementById('clearDb').onclick = async () => {
  await api('/api/admin/clear-db', { method: 'POST' });
  alert('Chats cleared');
};

document.getElementById('toggleReg').onclick = async () => {
  const s = await api('/api/settings');
  await api('/api/admin/registration', { method: 'POST', body: JSON.stringify({ open: !s.registration_open }) });
  alert('Updated');
};

document.getElementById('loadChats').onclick = async () => {
  const id = document.getElementById('conversationId').value;
  const chats = await api(`/api/conversations/${id}/messages`);
  document.getElementById('chatsView').textContent = JSON.stringify(chats, null, 2);
};

loadUsers();
