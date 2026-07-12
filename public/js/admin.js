document.addEventListener('DOMContentLoaded', () => {
  checkAdminAuth();
  initLogout();
});

async function checkAdminAuth() {
  try {
    const response = await fetch('/api/auth/check');
    const data = await response.json();
    
    if (!data.loggedIn || data.user.role !== 'admin') {
      window.location.href = '/login';
    }
  } catch (error) {
    window.location.href = '/login';
  }
}

function initLogout() {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    });
  }
}

async function uploadImage(file) {
  const formData = new FormData();
  formData.append('image', file);
  
  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData
  });
  
  const data = await response.json();
  if (data.success) {
    return data.url;
  }
  throw new Error('Upload failed');
}

function showAlert(message, type = 'success') {
  const alert = document.getElementById('alert');
  if (alert) {
    alert.textContent = message;
    alert.className = `alert alert-${type} show`;
    setTimeout(() => {
      alert.classList.remove('show');
    }, 3000);
  }
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('ar-SA');
}
