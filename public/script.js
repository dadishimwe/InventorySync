const db = new Dexie("inventoryDB");
db.version(1).stores({
  inventory: "++id, name, serialNumber, location, status, quantity, assignedTo, timestamp, syncStatus"
});

let currentUser = null;

function showSection(sectionId) {
  document.querySelectorAll('.section').forEach(section => section.style.display = 'none');
  document.getElementById(sectionId).style.display = 'block';
}

async function login() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.error) {
      document.getElementById('login-error').textContent = data.error;
    } else {
      currentUser = data.user;
      document.getElementById('user-name').textContent = currentUser.name;
      document.getElementById('user-role').textContent = currentUser.role;
      showSection('dashboard');
      updateDashboard();
      loadInventory();
      if (currentUser.role === 'admin') loadUsers();
      if (currentUser.role === 'client') loadAssignedInventory();
    }
  } catch (err) {
    document.getElementById('login-error').textContent = 'Server unavailable. Try again later.';
  }
}

function showRegister() {
  showSection('register');
  togglePermissionsRegister();
}

function showLogin() {
  showSection('login');
}

function showPasswordReset() {
  showSection('password-reset');
}

async function register() {
  const username = document.getElementById('reg-username').value;
  const name = document.getElementById('reg-name').value;
  const password = document.getElementById('reg-password').value;
  const role = document.getElementById('role').value;
  const permissions = role === 'client' ? document.getElementById('permissions').value : null;
  try {
    const res = await fetch('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, name, password, role, permissions })
    });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
    } else {
      showLogin();
    }
  } catch (err) {
    alert('Registration failed. Try again later.');
  }
}

async function resetPassword() {
  const username = document.getElementById('reset-username').value;
  const newPassword = document.getElementById('reset-new-password').value;
  try {
    const res = await fetch('/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, newPassword })
    });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
    } else {
      showLogin();
    }
  } catch (err) {
    alert('Reset failed. Try again later.');
  }
}

function logout() {
  fetch('/logout', { method: 'POST' });
  currentUser = null;
  showSection('login');
}

function showChangePassword() {
  showSection('change-password');
}

function showDashboard() {
  showSection('dashboard');
}

async function changePassword() {
  const newPassword = document.getElementById('new-password').value;
  try {
    const res = await fetch('/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword })
    });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
    } else {
      showDashboard();
    }
  } catch (err) {
    alert('Change password failed.');
  }
}

function updateDashboard() {
  document.getElementById('staff-section').style.display = currentUser.role === 'staff' || currentUser.role === 'admin' ? 'block' : 'none';
  document.getElementById('admin-section').style.display = currentUser.role === 'admin' ? 'block' : 'none';
  document.getElementById('client-section').style.display = currentUser.role === 'client' ? 'block' : 'none';
  if (currentUser.role === 'staff' || currentUser.role === 'admin') {
    loadClientsForAssignment();
  }
}

async function submitInventoryItem() {
  const item = {
    name: document.getElementById('item-name').value,
    serialNumber: document.getElementById('serial-number').value,
    location: document.getElementById('location').value,
    status: document.getElementById('status').value,
    quantity: parseInt(document.getElementById('quantity').value),
    assignedTo: document.getElementById('assigned-to').value || null,
    timestamp: new Date().toISOString()
  };
  try {
    if (navigator.onLine) {
      const res = await fetch('/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item)
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
    } else {
      await db.inventory.add({ ...item, syncStatus: 'pending' });
      alert('Saved locally. Will sync when online.');
    }
    document.getElementById('inventory-form').reset();
    loadInventory();
  } catch (err) {
    document.getElementById('inventory-error').textContent = err.message;
  }
}

async function loadInventory() {
  const filter = document.getElementById('status-filter').value;
  let items = [];
  try {
    if (navigator.onLine) {
      const res = await fetch(`/inventory${filter ? `?status=${filter}` : ''}`);
      items = await res.json();
      await db.inventory.clear();
      await db.inventory.bulkAdd(items.map(item => ({ ...item, syncStatus: 'synced' })));
    } else {
      items = await db.inventory.where('syncStatus').notEqual('deleted').toArray();
    }
    const tbody = document.getElementById('inventory-body');
    tbody.innerHTML = '';
    items.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.name}</td>
        <td>${item.serialNumber}</td>
        <td>${item.location}</td>
        <td>${item.status}</td>
        <td>${item.quantity}</td>
        <td>${item.assignedTo ? item.assignedToName || item.assignedTo : 'Not Assigned'}</td>
        <td>
          ${currentUser.role === 'admin' || currentUser.role === 'staff' ? `<button onclick="editInventory(${item.id})">Edit</button>` : ''}
          ${currentUser.role === 'admin' ? `<button onclick="deleteInventory(${item.id})">Delete</button>` : ''}
        </td>`;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load inventory:', err);
  }
}

async function editInventory(id) {
  const item = await db.inventory.get(id) || (await (await fetch(`/inventory/${id}`)).json());
  const newStatus = prompt('New status:', item.status);
  const newQuantity = prompt('New quantity:', item.quantity);
  const newLocation = prompt('New location:', item.location);
  if (newStatus && newQuantity && newLocation) {
    const updatedItem = { ...item, status: newStatus, quantity: parseInt(newQuantity), location: newLocation };
    try {
      if (navigator.onLine) {
        const res = await fetch(`/inventory/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedItem)
        });
        if (!res.ok) throw new Error('Update failed');
      } else {
        await db.inventory.update(id, { ...updatedItem, syncStatus: 'pending' });
      }
      loadInventory();
    } catch (err) {
      alert('Edit failed: ' + err.message);
    }
  }
}

async function deleteInventory(id) {
  if (confirm('Delete this item?')) {
    try {
      if (navigator.onLine) {
        const res = await fetch(`/inventory/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');
      } else {
        await db.inventory.update(id, { syncStatus: 'deleted' });
      }
      loadInventory();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  }
}

async function createUser() {
  const user = {
    username: document.getElementById('new-user-username').value,
    name: document.getElementById('new-user-name').value,
    password: document.getElementById('new-user-password').value,
    role: document.getElementById('new-user-role').value,
    permissions: document.getElementById('new-user-role').value === 'client' ? document.getElementById('new-user-permissions').value : null
  };
  try {
    const res = await fetch('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    loadUsers();
  } catch (err) {
    alert('User creation failed: ' + err.message);
  }
}

async function loadUsers() {
  try {
    const res = await fetch('/users');
    const users = await res.json();
    const tbody = document.getElementById('users-body');
    tbody.innerHTML = '';
    document.getElementById('assigned-to').innerHTML = '<option value="">Not Assigned</option>' + 
      users.filter(u => u.role === 'client').map(u => `<option value="${u.id}">${u.name}</option>`).join('');
    users.forEach(user => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${user.id}</td>
        <td>${user.username}</td>
        <td>${user.name}</td>
        <td>${user.role}</td>
        <td>${user.permissions || 'N/A'}</td>
        <td><button onclick="deleteUser(${user.id})">Delete</button></td>`;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load users:', err);
  }
}

async function loadClientsForAssignment() {
  try {
    const res = await fetch('/users?role=client');
    const clients = await res.json();
    const select = document.getElementById('assigned-to');
    select.innerHTML = '<option value="">Not Assigned</option>' + 
      clients.map(client => `<option value="${client.id}">${client.name}</option>`).join('');
  } catch (err) {
    console.error('Failed to load clients:', err);
  }
}

async function deleteUser(id) {
  if (confirm('Delete this user?')) {
    try {
      const res = await fetch(`/users/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      loadUsers();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  }
}

async function loadAssignedInventory() {
  try {
    const res = await fetch('/inventory/assigned');
    const items = await res.json();
    const tbody = document.getElementById('assigned-inventory-body');
    tbody.innerHTML = '';
    items.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.name}</td>
        <td>${item.serialNumber}</td>
        <td>${item.location}</td>
        <td>${item.status}</td>
        <td>${item.quantity}</td>
        <td>${currentUser.permissions === 'read_write' ? `<button onclick="editAssignedInventory(${item.id})">Edit</button>` : ''}</td>`;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load assigned inventory:', err);
  }
}

async function editAssignedInventory(id) {
  const item = await (await fetch(`/inventory/${id}`)).json();
  const newStatus = prompt('New status:', item.status);
  const newQuantity = prompt('New quantity:', item.quantity);
  const newLocation = prompt('New location:', item.location);
  if (newStatus && newQuantity && newLocation) {
    try {
      const res = await fetch(`/inventory/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, quantity: parseInt(newQuantity), location: newLocation })
      });
      if (!res.ok) throw new Error('Update failed');
      loadAssignedInventory();
    } catch (err) {
      alert('Edit failed: ' + err.message);
    }
  }
}

function toggleUsersList() {
  const list = document.getElementById('users-list');
  list.style.display = list.style.display === 'none' ? 'block' : 'none';
}

function togglePermissions() {
  const role = document.getElementById('new-user-role').value;
  document.getElementById('new-user-permissions').style.display = role === 'client' ? 'inline' : 'none';
}

function togglePermissionsRegister() {
  const role = document.getElementById('role').value;
  document.getElementById('permissions').style.display = role === 'client' ? 'inline' : 'none';
}

async function syncData() {
  if (!navigator.onLine) {
    alert('You are offline. Please connect to sync.');
    return;
  }
  const pending = await db.inventory.where('syncStatus').equals('pending').toArray();
  const deleted = await db.inventory.where('syncStatus').equals('deleted').toArray();
  try {
    for (const item of pending) {
      const method = item.id ? 'PUT' : 'POST';
      const url = item.id ? `/inventory/${item.id}` : '/inventory';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item)
      });
      if (res.ok) await db.inventory.update(item.id, { syncStatus: 'synced' });
    }
    for (const item of deleted) {
      if (item.id) {
        const res = await fetch(`/inventory/${item.id}`, { method: 'DELETE' });
        if (res.ok) await db.inventory.delete(item.id);
      }
    }
    alert('Sync completed.');
    loadInventory();
  } catch (err) {
    alert('Sync failed: ' + err.message);
  }
}

async function generateReport() {
  try {
    const res = await fetch('/reports/inventory');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inventory_report.csv';
    a.click();
  } catch (err) {
    alert('Report generation failed: ' + err.message);
  }
}

window.addEventListener('online', () => document.getElementById('sync-btn').style.display = 'block');
window.addEventListener('offline', () => document.getElementById('sync-btn').style.display = 'none');