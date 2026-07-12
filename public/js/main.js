document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initHeroSlider();
  loadProducts();
  loadContact();
  loadCounters();
  checkAuth();
  initBackToTop();
  initSearch();
});

// ===== NAVBAR =====
function initNavbar() {
  const navbar = document.querySelector('.navbar');
  const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
  const navLinks = document.querySelector('.nav-links');

  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 50);
    const backToTop = document.querySelector('.back-to-top');
    if (backToTop) backToTop.classList.toggle('visible', window.scrollY > 500);
  });

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => navLinks.classList.toggle('active'));
  }

  document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', () => navLinks.classList.remove('active'));
  });
}

// ===== HERO SLIDER =====
let currentSlide = 0;
let slideInterval;

function initHeroSlider() {
  const slides = document.querySelectorAll('.hero-slide');
  if (slides.length <= 1) return;

  function showSlide(index) {
    slides.forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.hero-dot').forEach(d => d.classList.remove('active'));
    slides[index].classList.add('active');
    const dot = document.querySelector(`.hero-dot[data-slide="${index}"]`);
    if (dot) dot.classList.add('active');
  }

  function nextSlide() {
    currentSlide = (currentSlide + 1) % slides.length;
    showSlide(currentSlide);
  }

  function prevSlide() {
    currentSlide = (currentSlide - 1 + slides.length) % slides.length;
    showSlide(currentSlide);
  }

  document.querySelectorAll('.hero-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      currentSlide = parseInt(dot.dataset.slide);
      showSlide(currentSlide);
      resetInterval();
    });
  });

  function resetInterval() {
    clearInterval(slideInterval);
    slideInterval = setInterval(nextSlide, 5000);
  }

  resetInterval();
}

// ===== PRODUCTS =====
async function loadProducts() {
  const galleryGrid = document.querySelector('.gallery-grid');
  if (!galleryGrid) return;

  galleryGrid.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const params = new URLSearchParams();
    const searchInput = document.querySelector('.search-input');
    const minPrice = document.getElementById('minPrice');
    const maxPrice = document.getElementById('maxPrice');

    if (searchInput && searchInput.value) params.append('search', searchInput.value);
    if (minPrice && minPrice.value) params.append('minPrice', minPrice.value);
    if (maxPrice && maxPrice.value) params.append('maxPrice', maxPrice.value);
    params.append('available', 'true');

    const response = await fetch('/api/products?' + params.toString());
    const products = await response.json();

    if (products.length === 0) {
      galleryGrid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          <i class="fas fa-couch"></i>
          <h3>لا توجد منتجات</h3>
          <p>جرب البحث بكلمات مختلفة</p>
        </div>`;
      return;
    }

    galleryGrid.innerHTML = products.map(product => `
      <div class="product-card" data-category="${product.category}" data-id="${product.id}">
        <div class="product-image">
          <img src="${getProductImage(product)}" alt="${product.name}" 
               onerror="this.src='/images/placeholder.jpg'">
          <span class="product-badge">${getCategoryName(product.category)}</span>
          <button class="product-quick-view" onclick="quickView(${product.id})">
            <i class="fas fa-eye"></i> عرض سريع
          </button>
          <div class="product-share">
            <button class="share-btn" onclick="shareWhatsApp('${product.name}', ${product.id})" title="واتساب">
              <i class="fab fa-whatsapp"></i>
            </button>
            <button class="share-btn" onclick="shareFacebook(${product.id})" title="فيسبوك">
              <i class="fab fa-facebook-f"></i>
            </button>
            <button class="share-btn" onclick="shareTwitter('${product.name}', ${product.id})" title="تويتر">
              <i class="fab fa-twitter"></i>
            </button>
          </div>
        </div>
        <div class="product-info">
          <h3>${product.name}</h3>
          <p>${product.description || ''}</p>
          <div class="product-footer">
            <div class="product-price">$${product.price.toLocaleString()}</div>
            <a href="/product.html?id=${product.id}" class="product-details-btn">التفاصيل</a>
          </div>
        </div>
      </div>
    `).join('');

  } catch (error) {
    galleryGrid.innerHTML = '<div class="empty-state"><p>حدث خطأ في تحميل المنتجات</p></div>';
  }
}

function getCategoryName(cat) {
  const names = { salon: 'صالونات', bedroom: 'غرف نوم', dining: 'طاولات طعام', lshape: 'L Shape', other: 'قسم آخر', general: 'عام' };
  return names[cat] || cat;
}

function getProductImage(product) {
  try {
    const images = JSON.parse(product.images || '[]');
    if (images.length > 0) return images[0];
  } catch {}
  return product.image_url || '/images/placeholder.jpg';
}

function filterProducts(category) {
  const cards = document.querySelectorAll('.product-card');
  document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
  cards.forEach(card => {
    card.style.display = (category === 'all' || card.dataset.category === category) ? 'block' : 'none';
  });
}

// ===== QUICK VIEW =====
async function quickView(productId) {
  try {
    const response = await fetch('/api/products/' + productId);
    const product = await response.json();

    const modal = document.getElementById('quickViewModal');
    if (!modal) return;

    document.getElementById('qvImage').src = getProductImage(product);
    document.getElementById('qvName').textContent = product.name;
    document.getElementById('qvPrice').textContent = '$' + product.price.toLocaleString();
    document.getElementById('qvDescription').textContent = product.description || 'لا يوجد وصف';
    document.getElementById('qvCategory').textContent = getCategoryName(product.category);
    document.getElementById('qvDetailsLink').href = '/product.html?id=' + product.id;

    modal.classList.add('active');
  } catch (error) {
    showToast('حدث خطأ', 'error');
  }
}

function closeQuickView() {
  document.getElementById('quickViewModal')?.classList.remove('active');
}

// ===== SHARE =====
function shareWhatsApp(name, id) {
  const url = window.location.origin + '/product.html?id=' + id;
  window.open(`https://wa.me/?text=${encodeURIComponent(name + ' - ' + url)}`, '_blank');
}

function shareFacebook(id) {
  const url = window.location.origin + '/product.html?id=' + id;
  window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
}

function shareTwitter(name, id) {
  const url = window.location.origin + '/product.html?id=' + id;
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(name)}&url=${encodeURIComponent(url)}`, '_blank');
}

// ===== SEARCH =====
function initSearch() {
  const searchInput = document.querySelector('.search-input');
  if (!searchInput) return;

  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(loadProducts, 400);
  });

  const minPrice = document.getElementById('minPrice');
  const maxPrice = document.getElementById('maxPrice');
  [minPrice, maxPrice].forEach(el => {
    if (el) el.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(loadProducts, 400);
    });
  });
}

// ===== COUNTERS =====
function loadCounters() {
  const counterSection = document.querySelector('.counter-section');
  if (!counterSection) return;

  const counters = counterSection.querySelectorAll('.counter-number');
  if (counters.length === 0) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        counters.forEach(counter => {
          const target = parseInt(counter.dataset.target);
          const duration = 2000;
          const increment = target / (duration / 16);
          let current = 0;

          const updateCounter = () => {
            current += increment;
            if (current < target) {
              counter.textContent = Math.floor(current);
              requestAnimationFrame(updateCounter);
            } else {
              counter.textContent = target.toLocaleString();
            }
          };
          updateCounter();
        });
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  observer.observe(counterSection);
}

// ===== CONTACT =====
async function loadContact() {
  try {
    const response = await fetch('/api/contact');
    const contact = await response.json();
    if (contact) {
      const phoneEl = document.querySelector('.contact-phone');
      const emailEl = document.querySelector('.contact-email');
      const addressEl = document.querySelector('.contact-address');
      const hoursEl = document.querySelector('.contact-hours');
      const mapEl = document.querySelector('.contact-map iframe');

      if (phoneEl) phoneEl.textContent = contact.phone || '';
      if (emailEl) emailEl.textContent = contact.email || '';
      if (addressEl) addressEl.textContent = contact.address || '';
      if (hoursEl) hoursEl.textContent = contact.working_hours || '';
      if (mapEl && contact.map_embed_url) mapEl.src = contact.map_embed_url;
    }
  } catch (error) {
    console.error('Error loading contact:', error);
  }
}

// ===== SEND MESSAGE =====
async function sendMessage(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';

  try {
    const data = {
      name: form.querySelector('[name="name"]').value,
      email: form.querySelector('[name="email"]').value,
      phone: form.querySelector('[name="phone"]').value,
      subject: form.querySelector('[name="subject"]').value,
      message: form.querySelector('[name="message"]').value
    };

    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const result = await response.json();
    if (result.success) {
      showToast('تم إرسال رسالتك بنجاح!', 'success');
      form.reset();
    } else {
      showToast(result.error || 'حدث خطأ', 'error');
    }
  } catch (error) {
    showToast('حدث خطأ في الإرسال', 'error');
  }

  submitBtn.disabled = false;
  submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> إرسال الرسالة';
}

// ===== AUTH =====
async function checkAuth() {
  try {
    const response = await fetch('/api/auth/check');
    const data = await response.json();

    const authLink = document.querySelector('.nav-auth-btn');
    if (data.loggedIn) {
      if (authLink) {
        if (data.user.role === 'admin') {
          authLink.href = '/admin';
          authLink.innerHTML = '<i class="fas fa-cog"></i> لوحة التحكم';
        } else {
          authLink.href = '#';
          authLink.innerHTML = '<i class="fas fa-user"></i> ' + data.user.username;
        }
      }
    } else {
      if (authLink) {
        authLink.href = '/login';
        authLink.innerHTML = '<i class="fas fa-sign-in-alt"></i> تسجيل الدخول';
      }
    }
  } catch (error) {
    console.error('Error checking auth:', error);
  }
}

// ===== BACK TO TOP =====
function initBackToTop() {
  const btn = document.querySelector('.back-to-top');
  if (btn) {
    btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }
}

// ===== TOAST =====
function showToast(message, type = 'info') {
  const container = document.querySelector('.toast-container');
  if (!container) return;

  const icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fas ${icons[type] || icons.info}"></i>
    <span>${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
