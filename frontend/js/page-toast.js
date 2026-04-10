(function pageToastBootstrap() {
  const STYLE_ID = 'skillboost-page-toast-style';
  const TOAST_ID = 'skillboostPageToast';
  let hideTimeoutId = null;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.page-toast {
  position: fixed;
  top: 1rem;
  left: 50%;
  width: min(24rem, calc(100vw - 1.5rem));
  padding: 0.9rem 1rem;
  border-radius: 1rem;
  border: 1px solid rgba(255, 255, 255, 0.24);
  color: #ffffff;
  background: rgba(37, 99, 235, 0.96);
  box-shadow: 0 1rem 2.4rem rgba(15, 23, 42, 0.2);
  opacity: 0;
  transform: translate(-50%, -1rem);
  pointer-events: none;
  transition: opacity 0.25s ease, transform 0.25s ease;
  z-index: 9999;
  font-size: 0.94rem;
  font-weight: 600;
  line-height: 1.45;
  text-align: center;
  backdrop-filter: blur(0.9rem);
}

.page-toast.show {
  opacity: 1;
  transform: translate(-50%, 0);
}

.page-toast.info {
  background: rgba(37, 99, 235, 0.96);
}

.page-toast.success {
  background: rgba(16, 185, 129, 0.96);
}

.page-toast.warning {
  background: rgba(180, 83, 9, 0.96);
}

.page-toast.error {
  background: rgba(220, 38, 38, 0.96);
}
`;

    document.head.appendChild(style);
  }

  function ensureToastElement() {
    ensureStyles();

    let toast = document.getElementById(TOAST_ID);
    if (toast) {
      return toast;
    }

    toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.className = 'page-toast';
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-atomic', 'true');

    if (document.body) {
      document.body.appendChild(toast);
    } else {
      document.documentElement.appendChild(toast);
    }

    return toast;
  }

  function hide() {
    const toast = document.getElementById(TOAST_ID);
    if (!toast) {
      return;
    }

    toast.classList.remove('show');
  }

  function show(message, tone = 'info', durationMs = 3200) {
    if (!message) {
      return;
    }

    const toast = ensureToastElement();
    toast.textContent = String(message);
    toast.className = `page-toast show ${tone}`;

    window.clearTimeout(hideTimeoutId);
    hideTimeoutId = window.setTimeout(() => {
      hide();
    }, durationMs);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureToastElement();
    }, { once: true });
  } else {
    ensureToastElement();
  }

  window.SkillBoostPageToast = {
    hide,
    show
  };
})();
