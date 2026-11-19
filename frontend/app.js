/* Connects the supplied interface to the workshop API. */
let csrfToken = null;
let csrfHeader = 'X-CSRF-TOKEN';
let mutationInProgress = false;
let modalPreviousFocus = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[ch]));
}

function workshopNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Ho_Chi_Minh', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(new Date());
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}
getFormattedDateOffset = function (offset = 0) {
  const now = workshopNow();
  return new Date(Date.UTC(Number(now.year), Number(now.month) - 1, Number(now.day) + offset)).toISOString().slice(0, 10);
};
function bookableSlot(date, slot) {
  if (!date || !slot || new Date(date + 'T00:00:00Z').getUTCDay() === 0) return false;
  const today = getFormattedDateOffset();
  if (date < today) return false;
  const now = workshopNow();
  return date > today || slot > `${now.hour}:${now.minute}`;
}
for (let offset = 0; offset < 8; offset++) {
  const date = getFormattedDateOffset(offset);
  const slot = TIME_SLOTS.find(time => bookableSlot(date, time));
  if (slot) { selectedBookingDate = date; selectedBookingSlot = slot; break; }
}

// Resolve the backend API base URL.
// Priority:
// 1. window.BACKEND_API_URL or window.BACKEND_URL (global / window config)
// 2. localStorage.getItem('BACKEND_API_URL') or localStorage.getItem('BACKEND_URL') (persistent client config)
// 3. '' (relative paths /api/*, seamlessly routed by Netlify rewrite proxy or same-origin host)
function getBackendBaseUrl() {
  if (typeof window !== 'undefined') {
    if (window.BACKEND_API_URL && typeof window.BACKEND_API_URL === 'string') {
      return window.BACKEND_API_URL.trim().replace(/\/+$/, '');
    }
    if (window.BACKEND_URL && typeof window.BACKEND_URL === 'string') {
      return window.BACKEND_URL.trim().replace(/\/+$/, '');
    }
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('BACKEND_API_URL') || localStorage.getItem('BACKEND_URL');
      if (stored && typeof stored === 'string') {
        return stored.trim().replace(/\/+$/, '');
      }
    }
  } catch (_) { /* Ignore storage access errors in restricted contexts */ }
  return '';
}

function resolveApiUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const base = getBackendBaseUrl();
  if (!base) return path;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

async function refreshCsrf() {
  const url = resolveApiUrl('/api/csrf');
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Accept': 'application/json'
    }
  });
  if (!response.ok) throw new Error('Không thể kết nối đến máy chủ');
  const data = await response.json();
  csrfToken = data.token; csrfHeader = data.headerName || 'X-CSRF-TOKEN';
}

async function api(path, {method = 'GET', body, form = false, retry = true} = {}) {
  const headers = {};
  if (method !== 'GET') {
    if (!csrfToken) await refreshCsrf();
    if (csrfToken && csrfHeader) {
      headers[csrfHeader] = csrfToken;
    }
    headers['Content-Type'] = form ? 'application/x-www-form-urlencoded;charset=UTF-8' : 'application/json';
  }
  const url = resolveApiUrl(path);
  const response = await fetch(url, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : form ? new URLSearchParams(body) : JSON.stringify(body)
  });
  if (!response.ok) {
    if (response.status === 403 && method !== 'GET' && retry) {
      try {
        csrfToken = null;
        await refreshCsrf();
        return await api(path, {method, body, form, retry: false});
      } catch (_) { /* Fall through to error handler */ }
    }
    let message = response.status === 401 ? 'Số điện thoại hoặc mật khẩu không chính xác'
      : response.status === 403 ? 'Bạn không có quyền thực hiện thao tác này' : 'Không thể thực hiện yêu cầu';
    try {
      const json = await response.json();
      if (json && json.message && json.message !== 'No message available') {
        message = json.message;
      } else if (response.status === 401) {
        message = 'Số điện thoại hoặc mật khẩu không chính xác';
      }
    } catch (_) { /* Security responses may have no JSON body. */ }
    if (message === 'No message available') {
      message = 'Số điện thoại hoặc mật khẩu không chính xác';
    }
    throw new Error(message);
  }
  if (response.status === 204 || response.headers.get('content-length') === '0') return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function refreshState() {
  appState = await api('/api/state');
  syncAllViews();
}

async function perform(action) {
  if (mutationInProgress) return;
  mutationInProgress = true;
  try { await action(); }
  catch (error) {
    let msg = error.message || 'Không thể kết nối đến máy chủ';
    if (msg.includes('No message available')) {
      msg = 'Số điện thoại hoặc mật khẩu không chính xác';
    }
    showToast(msg, 'error');
  }
  finally { mutationInProgress = false; }
}

function showConnectionBanner(attempt, maxAttempts) {
  let banner = document.getElementById('coldStartBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'coldStartBanner';
    banner.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-signal text-white shadow-2xl backdrop-blur-md text-xs font-semibold animate-pulse transition-all duration-300';
    document.body.appendChild(banner);
  }
  const attemptText = attempt > 1 ? ` (Thử lại lần ${attempt}/${maxAttempts})` : '';
  banner.innerHTML = `
    <i class="fa-solid fa-spinner fa-spin text-sm"></i>
    <span>Đang kết nối đến máy chủ (Render Free Tier khởi động lần đầu mất 30-45 giây)...${attemptText}</span>
  `;
  banner.style.display = 'flex';
  banner.style.opacity = '1';
}

function hideConnectionBanner() {
  const banner = document.getElementById('coldStartBanner');
  if (banner) {
    banner.style.opacity = '0';
    banner.style.transform = 'translate(-50%, -10px)';
    setTimeout(() => { banner.remove(); }, 300);
  }
}

async function initializeApp() {
  const maxAttempts = 8;
  const retryDelayMs = 5000;
  let connected = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        showConnectionBanner(attempt, maxAttempts);
      }
      await refreshCsrf();
      await refreshState();
      connected = true;
      hideConnectionBanner();
      break;
    } catch (error) {
      console.warn(`[Auto-Reconnect] Attempt ${attempt}/${maxAttempts} failed:`, error.message);
      if (attempt < maxAttempts) {
        showConnectionBanner(attempt, maxAttempts);
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      } else {
        hideConnectionBanner();
        showToast('Không thể kết nối đến máy chủ sau nhiều lần thử. Vui lòng tải lại trang.', 'error');
        return;
      }
    }
  }

  if (!connected) return;

  try {
    const account = Array.isArray(appState.accounts) ? appState.accounts.find(a => a.id === appState.activeAccountId) : null;
    if (appState.authenticated && appState.currentRole === 'CUSTOMER' && account) {
      document.getElementById('bookCustomerName').value = account.name || '';
      document.getElementById('bookCustomerPhone').value = account.phone || '';
    }
    const bookDate = document.getElementById('bookDateInput');
    if (bookDate) bookDate.min = getFormattedDateOffset(0);

    window.setInterval(() => {
      if (!document.hidden && !mutationInProgress) refreshState().catch(() => {});
    }, 30000);
  } catch (err) {
    console.error('Error populating initial views:', err);
  }
}

const originalHeader = renderHeaderAndNav;
renderHeaderAndNav = function () {
  originalHeader();
  document.getElementById('dropdownAccountList').innerHTML = '';
  document.getElementById('accountAction').textContent = appState.authenticated ? 'Đăng xuất' : 'Đăng nhập / Đăng ký';
};

const originalOpenModal = openModal;
const originalCloseModal = closeModal;
openModal = function (id) {
  const modal = document.getElementById(id);
  modalPreviousFocus = document.activeElement;
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  const title = modal.querySelector('h3');
  if (title) { if (!title.id) title.id = `${id}-title`; modal.setAttribute('aria-labelledby', title.id); }
  originalOpenModal(id);
  modal.querySelector('button, input, select, textarea')?.focus();
};
closeModal = function (id) {
  originalCloseModal(id);
  if (modalPreviousFocus && document.contains(modalPreviousFocus)) modalPreviousFocus.focus();
};

// The API exposes aggregate occupancy, not other customers' appointment details.
getSlotLoadCount = function (date, slot, excludeId = null) {
  let count = appState.slotCounts[`${date}|${slot}`] || 0;
  const excluded = appState.appointments.find(a => a.id === excludeId);
  if (excluded && excluded.date === date && excluded.slot === slot && STATUS_META[excluded.status]?.countsCapacity) count--;
  return Math.max(0, count);
};

const originalBookingSlots = renderBookingTimeSlots;
renderBookingTimeSlots = function () {
  if (!bookableSlot(selectedBookingDate, selectedBookingSlot) ||
      getSlotLoadCount(selectedBookingDate, selectedBookingSlot) >= appState.maxCapacityPerSlot) {
    selectedBookingSlot = TIME_SLOTS.find(slot => bookableSlot(selectedBookingDate, slot) &&
      getSlotLoadCount(selectedBookingDate, slot) < appState.maxCapacityPerSlot) || null;
  }
  originalBookingSlots();
  document.querySelectorAll('#bookingTimeSlotGrid button').forEach((button, index) => {
    if (!bookableSlot(selectedBookingDate, TIME_SLOTS[index])) {
      button.disabled = true; button.classList.add('opacity-50', 'cursor-not-allowed');
      button.lastElementChild.textContent = new Date(selectedBookingDate + 'T00:00:00Z').getUTCDay() === 0 ? 'Xưởng nghỉ Chủ nhật' : 'Đã qua';
    }
  });
};
const originalRescheduleSlots = renderRescheduleSlots;
renderRescheduleSlots = function () {
  const date = document.getElementById('rescheduleDateInput').value;
  if (!bookableSlot(date, rescheduleSelectedSlot)) rescheduleSelectedSlot = null;
  originalRescheduleSlots();
  document.querySelectorAll('#rescheduleSlotGrid button').forEach((button, index) => {
    if (!bookableSlot(date, TIME_SLOTS[index])) {
      button.disabled = true; button.classList.add('opacity-40', 'cursor-not-allowed');
      button.lastElementChild.textContent = 'Không nhận';
    }
  });
};
const originalWalkInSlots = populateWalkinSlots;
populateWalkinSlots = function () {
  originalWalkInSlots();
  const date = document.getElementById('walkinDate').value;
  document.querySelectorAll('#walkinSlot option').forEach(option => {
    if (!bookableSlot(date, option.value)) { option.disabled = true; option.textContent += ' — Không nhận'; }
  });
};

// Build category controls using DOM APIs so category names are never executable code.
renderServiceCategoryPills = function () {
  const container = document.getElementById('serviceCategoryPills');
  container.replaceChildren();
  const categories = ['Tất cả', ...new Set(appState.services.filter(s => s.active).map(s => s.category))];
  for (const category of categories) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = category;
    button.className = 'px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition ' +
      (selectedCategoryFilter === category ? 'bg-signal text-white' : 'card-elevated text-[var(--text-muted)]');
    button.addEventListener('click', () => setServiceCategory(category));
    container.appendChild(button);
  }
};

function togglePasswordVisibility(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  if (!input) return;
  const isPassword = input.type === 'password' || input.getAttribute('type') === 'password';
  const nextType = isPassword ? 'text' : 'password';
  input.type = nextType;
  input.setAttribute('type', nextType);
  if (icon) {
    if (isPassword) {
      icon.classList.remove('fa-eye');
      icon.classList.add('fa-eye-slash');
    } else {
      icon.classList.remove('fa-eye-slash');
      icon.classList.add('fa-eye');
    }
    // Trigger smooth eye pop animation via void reflow
    icon.classList.remove('eye-animating');
    void icon.offsetWidth;
    icon.classList.add('eye-animating');
  }
}
window.togglePasswordVisibility = togglePasswordVisibility;

function resetPasswordVisibility(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  if (input) {
    input.type = 'password';
    input.setAttribute('type', 'password');
  }
  if (icon) {
    icon.classList.remove('fa-eye-slash', 'eye-animating');
    icon.classList.add('fa-eye');
  }
}

function normalizePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return '';
  let cleaned = phone.trim().replace(/[\s.\-()]/g, '');
  if (cleaned.startsWith('+84')) {
    cleaned = '0' + cleaned.slice(3);
  } else if (/^84\d{9,10}$/.test(cleaned)) {
    cleaned = '0' + cleaned.slice(2);
  }
  return cleaned;
}
window.normalizePhoneNumber = normalizePhoneNumber;

setCustomerTrackScope = function () { customerTrackScope = 'MINE'; renderCustomerTrackingList(); };
quickFillLogin = function (phone, password) {
  const phoneInput = document.getElementById('loginPhoneInput');
  const passInput = document.getElementById('loginPasswordInput');
  if (phoneInput) {
    phoneInput.value = phone;
    phoneInput.focus();
  }
  if (passInput) {
    passInput.value = password;
  }
  showToast(`Đã chọn tài khoản ${phone} (Mật khẩu: ${password})`, 'info');
};
openLoginModal = function () {
  document.getElementById('userDropdownMenu').classList.add('hidden');
  resetPasswordVisibility('loginPasswordInput', 'loginPasswordToggleIcon');
  resetPasswordVisibility('registerPassword', 'registerPasswordToggleIcon');
  toggleRegistration(false); openModal('modalLogin');
  document.getElementById('loginPhoneInput').focus();
};
function toggleRegistration(show) {
  document.getElementById('loginFields').classList.toggle('hidden', show);
  document.getElementById('registrationFields').classList.toggle('hidden', !show);
  document.getElementById('loginTitle').textContent = show ? 'Tạo tài khoản khách hàng' : 'Đăng nhập Hệ thống';
}
async function login(phone, password) {
  await api('/api/login', {method:'POST', form:true, body:{phone, password}});
  csrfToken = null; await refreshCsrf(); await refreshState();
  closeModal('modalLogin');
  const account = Array.isArray(appState.accounts) ? appState.accounts.find(a => a.id === appState.activeAccountId) : null;
  if (account && account.role === 'CUSTOMER') {
    document.getElementById('bookCustomerName').value = account.name || '';
    document.getElementById('bookCustomerPhone').value = account.phone || '';
  }
  document.getElementById('loginPasswordInput').value = '';
  document.getElementById('registerPassword').value = '';
  resetPasswordVisibility('loginPasswordInput', 'loginPasswordToggleIcon');
  resetPasswordVisibility('registerPassword', 'registerPasswordToggleIcon');
  showToast('Đăng nhập thành công', 'success');
}
handlePhoneLogin = function () {
  const phoneInput = document.getElementById('loginPhoneInput');
  const passwordInput = document.getElementById('loginPasswordInput');
  const phoneRaw = phoneInput.value.trim();
  const password = passwordInput.value;

  if (phoneRaw.includes('@') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(phoneRaw)) {
    showToast('Hệ thống hiện tại đăng nhập bằng Số điện thoại (ví dụ: 0901234567, 0912345678, 0988888888)', 'error');
    phoneInput.focus();
    return;
  }

  const phone = normalizePhoneNumber(phoneRaw);
  if (!phone || !/^0\d{9,10}$/.test(phone)) {
    showToast('Số điện thoại không đúng định dạng (bắt đầu bằng 0, gồm 10-11 chữ số)', 'error');
    phoneInput.focus();
    return;
  }
  if (!password || password.length < 8) {
    showToast('Mật khẩu phải có ít nhất 8 ký tự', 'error');
    passwordInput.focus();
    return;
  }
  phoneInput.value = phone;

  const submitBtn = document.getElementById('loginSubmitBtn');
  const originalContent = submitBtn ? submitBtn.innerHTML : 'Đăng nhập';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Đang đăng nhập...';
  }

  perform(async () => {
    try {
      await login(phone, password);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalContent;
      }
    }
  });
};
function registerCustomer() {
  const nameInput = document.getElementById('registerName');
  const phoneInput = document.getElementById('registerPhone');
  const passwordInput = document.getElementById('registerPassword');

  const name = nameInput.value.trim();
  const phoneRaw = phoneInput.value.trim();
  const password = passwordInput.value;

  if (phoneRaw.includes('@')) {
    showToast('Hệ thống hiện tại đăng ký bằng Số điện thoại (ví dụ: 0901234567)', 'error');
    phoneInput.focus();
    return;
  }

  const phone = normalizePhoneNumber(phoneRaw);
  if (!name) {
    showToast('Vui lòng nhập họ và tên', 'error');
    nameInput.focus();
    return;
  }
  if (!phone || !/^0\d{9,10}$/.test(phone)) {
    showToast('Số điện thoại không đúng định dạng (bắt đầu bằng 0, gồm 10-11 chữ số)', 'error');
    phoneInput.focus();
    return;
  }
  if (!password || password.length < 8) {
    showToast('Mật khẩu phải có ít nhất 8 ký tự', 'error');
    passwordInput.focus();
    return;
  }

  phoneInput.value = phone;

  const submitBtn = document.getElementById('registerSubmitBtn');
  const originalContent = submitBtn ? submitBtn.innerHTML : 'Đăng ký';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Đang xử lý...';
  }

  perform(async () => {
    try {
      await api('/api/register', {method:'POST', body:{name, phone, password, meta:''}});
      await login(phone, password);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalContent;
      }
    }
  });
}
function handleAccountAction() {
  if (!appState.authenticated) { openLoginModal(); return; }
  perform(async () => {
    await api('/api/logout', {method:'POST'}); csrfToken = null; await refreshCsrf();
    document.getElementById('bookCustomerName').value = '';
    document.getElementById('bookCustomerPhone').value = '';
    document.getElementById('bookLicensePlate').value = '';
    document.getElementById('bookCarModel').value = '';
    document.getElementById('userDropdownMenu').classList.add('hidden');
    customerActiveTab = 'BOOKING'; await refreshState(); switchCustomerTab('BOOKING');
    showToast('Đã đăng xuất', 'info');
  });
}

async function withButtonLoading(buttonOrId, loadingText, action) {
  const btn = typeof buttonOrId === 'string' ? document.getElementById(buttonOrId) : buttonOrId;
  const originalHtml = btn ? btn.innerHTML : null;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin mr-2"></i>${loadingText}`;
  }
  try {
    return await action();
  } finally {
    if (btn && originalHtml !== null) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

submitCustomerBooking = function () {
  if (!appState.authenticated) { openLoginModal(); showToast('Vui lòng đăng nhập để đặt lịch', 'info'); return; }
  const btn = document.getElementById('btnSubmitBooking') || document.querySelector('button[onclick*="submitCustomerBooking"]');
  withButtonLoading(btn, 'Đang đặt lịch...', () => perform(async () => {
    const body = {
      customerName: document.getElementById('bookCustomerName').value.trim(),
      phone: document.getElementById('bookCustomerPhone').value.trim(),
      licensePlate: document.getElementById('bookLicensePlate').value.trim().toUpperCase(),
      carModel: document.getElementById('bookCarModel').value.trim(),
      date:selectedBookingDate, slot:selectedBookingSlot, serviceIds:selectedBookingServiceIds,
      note:document.getElementById('bookSymptomNote').value.trim(), walkIn:false
    };
    const created = await api('/api/appointments', {method:'POST', body});
    document.getElementById('bookSymptomNote').value = '';
    await refreshState(); switchCustomerTab('TRACKING'); showToast(`Đã đặt lịch #${created.id}`, 'success');
  }));
};

confirmRescheduleBooking = function () {
  const btn = document.getElementById('btnConfirmReschedule') || document.querySelector('button[onclick*="confirmRescheduleBooking"]');
  withButtonLoading(btn, 'Đang lưu...', () => perform(async () => {
    const id = document.getElementById('rescheduleApptId').value;
    const date = document.getElementById('rescheduleDateInput').value;
    const serviceIds = Array.from(document.querySelectorAll('input[name="rescheduleSrv"]:checked')).map(item => item.value);
    await api(`/api/appointments/${encodeURIComponent(id)}/schedule`, {method:'PUT', body:{date, slot:rescheduleSelectedSlot, serviceIds}});
    closeModal('modalReschedule'); await refreshState(); showToast('Đã đổi lịch và gửi xác nhận lại', 'success');
  }));
};

confirmCancelOrReject = function () {
  perform(async () => {
    const id = document.getElementById('cancelApptId').value;
    const status = document.getElementById('cancelActionMode').value === 'CUSTOMER_CANCEL' ? 'CANCELLED' : 'REJECTED';
    const reason = document.getElementById('cancelReasonInput').value.trim();
    await api(`/api/appointments/${encodeURIComponent(id)}/status`, {method:'PUT', body:{status, reason}});
    closeModal('modalCancelOrReject'); await refreshState(); showToast('Đã cập nhật lịch hẹn', 'success');
  });
};

submitStaffConfirm = function () {
  const btn = document.getElementById('btnSubmitStaffConfirm') || document.querySelector('button[onclick*="submitStaffConfirm"]');
  withButtonLoading(btn, 'Đang duyệt...', () => perform(async () => {
    const id = document.getElementById('staffConfirmApptId').value;
    const body = {status:'CONFIRMED', bay:document.getElementById('staffConfirmBay').value,
      technician:document.getElementById('staffConfirmTech').value, reason:document.getElementById('staffConfirmNote').value.trim()};
    await api(`/api/appointments/${encodeURIComponent(id)}/status`, {method:'PUT', body});
    closeModal('modalStaffConfirm'); await refreshState(); showToast('Đã duyệt lịch hẹn', 'success');
  }));
};
updateAppointmentStatus = function (id, status) {
  perform(async () => {
    await api(`/api/appointments/${encodeURIComponent(id)}/status`, {method:'PUT', body:{status}});
    await refreshState(); showToast('Đã cập nhật trạng thái lịch hẹn', 'success');
  });
};
const originalOpenWalkIn = openWalkInModal;
openWalkInModal = function () {
  originalOpenWalkIn();
  document.getElementById('walkinBay').innerHTML = document.getElementById('staffConfirmBay').innerHTML;
  document.getElementById('walkinTech').innerHTML = document.getElementById('staffConfirmTech').innerHTML;
};
submitWalkInBooking = function () {
  const btn = document.getElementById('btnSubmitWalkIn') || document.querySelector('button[onclick*="submitWalkInBooking"]');
  withButtonLoading(btn, 'Đang tạo...', () => perform(async () => {
    const body = {customerName:document.getElementById('walkinName').value.trim(), phone:document.getElementById('walkinPhone').value.trim(),
      licensePlate:document.getElementById('walkinPlate').value.trim().toUpperCase(), carModel:document.getElementById('walkinModel').value.trim(),
      date:document.getElementById('walkinDate').value, slot:document.getElementById('walkinSlot').value,
      serviceIds:Array.from(document.querySelectorAll('input[name="walkinSrv"]:checked')).map(item => item.value),
      walkIn:true, note:'Tiếp nhận trực tiếp', bay:document.getElementById('walkinBay').value, technician:document.getElementById('walkinTech').value};
    const created = await api('/api/appointments', {method:'POST', body});
    closeModal('modalWalkIn'); await refreshState(); showToast(`Đã tạo lịch #${created.id}`, 'success');
  }));
};

toggleServiceActive = function (id) {
  perform(async () => {
    const item = appState.services.find(s => s.id === id);
    const {id: ignoredId, ...fields} = item;
    await api(`/api/services/${encodeURIComponent(id)}`, {method:'PUT', body:{...fields, active:!item.active}});
    await refreshState(); showToast('Đã cập nhật trạng thái dịch vụ', 'success');
  });
};
const originalServiceEditor = openServiceEditorModal;
openServiceEditorModal = function (id = null) {
  originalServiceEditor(id); document.getElementById('editSrvCode').readOnly = !!id;
};
saveServiceFromModal = function () {
  const btn = document.getElementById('btnSaveService') || document.querySelector('button[onclick*="saveServiceFromModal"]');
  withButtonLoading(btn, 'Đang lưu...', () => perform(async () => {
    const id = document.getElementById('editSrvId').value;
    const existing = appState.services.find(s => s.id === id);
    const checklist = document.getElementById('editSrvChecklist').value.split(';').map(s => s.trim()).filter(Boolean);
    const body = {code:document.getElementById('editSrvCode').value.trim().toUpperCase(),
      category:document.getElementById('editSrvCategory').value, name:document.getElementById('editSrvName').value.trim(),
      duration:Number(document.getElementById('editSrvDuration').value), price:Number(document.getElementById('editSrvPrice').value),
      checklist, description:checklist.join(' • '), warranty:existing?.warranty || '', active:existing?.active ?? true};
    await api(id ? `/api/services/${encodeURIComponent(id)}` : '/api/services', {method:id ? 'PUT' : 'POST', body});
    closeModal('modalServiceEditor'); await refreshState(); showToast('Đã lưu dịch vụ', 'success');
  }));
};
adjustMaxCapacity = function (delta) {
  perform(async () => {
    await api('/api/capacity', {method:'PUT', body:{capacity:appState.maxCapacityPerSlot + delta}});
    await refreshState(); showToast('Đã cập nhật công suất', 'success');
  });
};
const originalOpenAddUser = openAddUserModal;
openAddUserModal = function () {
  originalOpenAddUser();
  resetPasswordVisibility('newUserPassword', 'newUserPasswordToggleIcon');
  document.getElementById('newUserPassword').value = '';
};
saveNewAccount = function () {
  const nameInput = document.getElementById('newUserName');
  const phoneInput = document.getElementById('newUserPhone');
  const roleInput = document.getElementById('newUserRole');
  const metaInput = document.getElementById('newUserMeta');
  const passwordInput = document.getElementById('newUserPassword');

  const name = nameInput.value.trim();
  const phone = normalizePhoneNumber(phoneInput.value);
  const role = roleInput.value;
  const meta = metaInput.value.trim();
  const password = passwordInput.value;

  if (!name) {
    showToast('Vui lòng nhập họ và tên', 'error');
    nameInput.focus();
    return;
  }
  if (!phone || !/^0\d{9,10}$/.test(phone)) {
    showToast('Số điện thoại không đúng định dạng (bắt đầu bằng 0, gồm 10-11 chữ số)', 'error');
    phoneInput.focus();
    return;
  }
  if (!password || password.length < 8) {
    showToast('Mật khẩu ban đầu phải có ít nhất 8 ký tự', 'error');
    passwordInput.focus();
    return;
  }

  phoneInput.value = phone;
  const btn = document.getElementById('btnSaveAccount') || document.querySelector('button[onclick*="saveNewAccount()"]');
  withButtonLoading(btn, 'Đang tạo...', () => perform(async () => {
    const body = {name, phone, role, meta, password};
    await api('/api/accounts', {method:'POST', body});
    passwordInput.value = '';
    resetPasswordVisibility('newUserPassword', 'newUserPasswordToggleIcon');
    closeModal('modalAddUser');
    await refreshState();
    showToast('Đã tạo tài khoản', 'success');
  }));
};

document.addEventListener('keydown', event => {
  const modal = document.querySelector('[id^="modal"][role="dialog"]:not(.hidden)');
  if (event.key === 'Escape' && modal) { event.preventDefault(); closeModal(modal.id); }
  if (event.key === 'Tab' && modal) {
    const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter(element => element.getClientRects().length);
    if (focusable.length && event.shiftKey && document.activeElement === focusable[0]) {
      event.preventDefault(); focusable[focusable.length - 1].focus();
    } else if (focusable.length && !event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
      event.preventDefault(); focusable[0].focus();
    }
  }
  if (event.key === 'Enter' && !document.getElementById('modalLogin').classList.contains('hidden')) {
    event.preventDefault();
    if (document.getElementById('registrationFields').classList.contains('hidden')) handlePhoneLogin(); else registerCustomer();
  }
});
