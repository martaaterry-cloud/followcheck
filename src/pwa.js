let swRegistration = null;
let updateAvailable = false;
let isRefreshing = false;
let stateChangeCallback = null;

export function initPwa(onStateChange) {
  stateChangeCallback = onStateChange;

  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // Prevenir bucle infinito en recarga de controllerchange
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!isRefreshing) {
      isRefreshing = true;
      window.location.reload();
    }
  });

  window.addEventListener('load', async () => {
    try {
      // Registrar SW relativo a la base
      const swUrl = `${import.meta.env.BASE_URL}sw.js`;
      swRegistration = await navigator.serviceWorker.register(swUrl);

      // Si ya hay un worker esperando
      if (swRegistration.waiting) {
        updateAvailable = true;
        notifyStateChange('update-available');
      }

      swRegistration.addEventListener('updatefound', () => {
        const newWorker = swRegistration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            updateAvailable = true;
            notifyStateChange('update-available');
          }
        });
      });
    } catch (err) {
      console.warn('No se pudo registrar el Service Worker:', err);
    }
  });
}

function notifyStateChange(status, extra = {}) {
  if (typeof stateChangeCallback === 'function') {
    stateChangeCallback({
      status,
      updateAvailable,
      ...extra
    });
  }
}

export function isUpdateAvailable() {
  return updateAvailable;
}

export async function checkPwaUpdate() {
  if (!('serviceWorker' in navigator)) {
    return {
      status: 'unsupported',
      message: 'Las actualizaciones de PWA no están soportadas en este navegador.'
    };
  }

  if (!swRegistration) {
    try {
      const swUrl = `${import.meta.env.BASE_URL}sw.js`;
      swRegistration = await navigator.serviceWorker.getRegistration(swUrl);
    } catch {
      // ignore
    }
  }

  if (!swRegistration) {
    return {
      status: 'up-to-date',
      message: 'Estás usando la versión actual.'
    };
  }

  try {
    notifyStateChange('checking');
    await swRegistration.update();

    if (swRegistration.waiting) {
      updateAvailable = true;
      notifyStateChange('update-available');
      return {
        status: 'update-available',
        message: '¡Nueva versión disponible para instalar!'
      };
    }

    if (swRegistration.installing) {
      return {
        status: 'installing',
        message: 'Descargando nueva versión en segundo plano…'
      };
    }

    updateAvailable = false;
    notifyStateChange('up-to-date');
    return {
      status: 'up-to-date',
      message: 'Estás usando la última versión.'
    };
  } catch (err) {
    console.warn('Error al verificar actualización:', err);
    return {
      status: 'error',
      message: 'No se pudo comprobar la actualización (comprueba tu conexión).'
    };
  }
}

export function applyPwaUpdate() {
  if (swRegistration && swRegistration.waiting) {
    swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
  } else {
    reloadApp();
  }
}

export function reloadApp() {
  window.location.reload();
}
