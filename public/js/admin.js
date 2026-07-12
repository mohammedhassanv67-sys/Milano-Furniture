document.addEventListener('DOMContentLoaded', () => {
  checkAdminAuth();
  initLogout();
  initSidebarToggle();
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

function initSidebarToggle() {
  const toggle = document.querySelector('.sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  
  if (!toggle || !sidebar) return;

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
  });

  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    });
  }

  // Close sidebar on link click (mobile)
  sidebar.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
      }
    });
  });
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
