// Environment configuration for dev/staging/prod
// Centralizes all environment-specific URLs and credentials

const ENVIRONMENTS = {
  dev: {
    name: 'Development',
    apiGateway: 'https://memorymachines-gateway-dev-a5fddsyy.uc.gateway.dev',
    authApiBase: 'https://memorymachines-gateway-dev-a5fddsyy.uc.gateway.dev',
    backendUrl: 'https://memory-machines-backend-dev-4ocorayf6a-uc.a.run.app',
    websocketUrl: 'https://memory-machines-websocket-dev-795455024362.us-central1.run.app',
    webappUrl: 'https://memorymachinesdev.web.app',
    firebase: {
      apiKey: 'AIzaSyApDlbf3kensbIpgkjzH5X-ehHDqJohp5M',
      authDomain: 'memorymachinesdev.firebaseapp.com',
      projectId: 'memorymachinesdev',
      storageBucket: 'memorymachinesdev.firebasestorage.app',
      messagingSenderId: '795455024362',
      appId: '1:795455024362:web:d7d77be076e472c3437b93',
      measurementId: 'G-5Q7FBXVPWP'
    },
    oauth: {
      clientId: '795455024362-example.apps.googleusercontent.com' // Replace with actual dev OAuth client ID
    }
  },
  staging: {
    name: 'Staging',
    apiGateway: 'https://memorymachines-gateway-staging-57wqy7gu.uc.gateway.dev',
    authApiBase: 'https://memorymachines-gateway-staging-57wqy7gu.uc.gateway.dev',
    backendUrl: 'https://memory-machines-backend-staging-409038480462.us-central1.run.app',
    websocketUrl: 'https://memory-machines-websocket-staging-409038480462.us-central1.run.app',
    webappUrl: 'https://memorymachines-staging.web.app',
    firebase: {
      apiKey: 'AIzaSyAOPF6EQ_oSDUhFbRMqKlezxm7C8-d7i_s',
      authDomain: 'memorymachines-staging.firebaseapp.com',
      projectId: 'memorymachines-staging',
      storageBucket: 'memorymachines-staging.firebasestorage.app',
      messagingSenderId: '409038480462',
      appId: '1:409038480462:web:15b3b66123c3836c1f4f1f',
      measurementId: 'G-5Q7FBXVPWP'
    },
    oauth: {
      clientId: '409038480462-jl34j5oli7cqhept7gj44vegn6ul7qu4.apps.googleusercontent.com'
    }
  },
  prod: {
    name: 'Production',
    apiGateway: 'https://memorymachines-gateway-prod-btf57kda.uc.gateway.dev',
    authApiBase: 'https://memorymachines-gateway-prod-btf57kda.uc.gateway.dev',
    backendUrl: 'https://memory-machines-backend-prod-42us6ic5ya-uc.a.run.app',
    websocketUrl: 'https://memory-machines-websocket-prod-42us6ic5ya-uc.a.run.app',
    webappUrl: 'https://memorymachines-prod.web.app',
    firebase: {
      apiKey: 'AIzaSyB7DIVqzT72Pg9KAhJQCxNgBw7ZeTyLkzc',
      authDomain: 'memorymachines-prod.firebaseapp.com',
      projectId: 'memorymachines-prod',
      storageBucket: 'memorymachines-prod.firebasestorage.app',
      messagingSenderId: '926048236510',
      appId: '1:926048236510:web:15ed4b8a18f757cf9c4932',
      measurementId: 'G-5Q7FBXVPWP'
    },
    oauth: {
      clientId: '926048236510-fp6bn6322ossvv57njaojtbhi04jus9o.apps.googleusercontent.com'
    }
  }
};

// Default environment
const DEFAULT_ENVIRONMENT = 'prod';

// Developer mode password
const DEV_MODE_PASSWORD = 'mm-internal-user';

/**
 * Get current environment configuration
 * @returns {Promise<Object>} Environment configuration
 */
async function getCurrentEnvironment() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['devModeEnabled', 'selectedEnvironment'], (result) => {
      const env = result.devModeEnabled && result.selectedEnvironment
        ? result.selectedEnvironment
        : DEFAULT_ENVIRONMENT;
      resolve(ENVIRONMENTS[env] || ENVIRONMENTS[DEFAULT_ENVIRONMENT]);
    });
  });
}

/**
 * Get environment name
 * @returns {Promise<string>} Environment name (dev/staging/prod)
 */
async function getEnvironmentName() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['devModeEnabled', 'selectedEnvironment'], (result) => {
      const env = result.devModeEnabled && result.selectedEnvironment
        ? result.selectedEnvironment
        : DEFAULT_ENVIRONMENT;
      resolve(env);
    });
  });
}

/**
 * Check if developer mode is enabled
 * @returns {Promise<boolean>}
 */
async function isDevModeEnabled() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['devModeEnabled'], (result) => {
      resolve(result.devModeEnabled || false);
    });
  });
}

/**
 * Validate developer mode password
 * @param {string} password
 * @returns {boolean}
 */
function validateDevModePassword(password) {
  return password === DEV_MODE_PASSWORD;
}

/**
 * Enable developer mode
 * @param {string} environment - dev/staging/prod
 * @returns {Promise<void>}
 */
async function enableDevMode(environment = 'prod') {
  return new Promise((resolve) => {
    chrome.storage.sync.set({
      devModeEnabled: true,
      selectedEnvironment: environment
    }, resolve);
  });
}

/**
 * Disable developer mode and reset to production
 * @returns {Promise<void>}
 */
async function disableDevMode() {
  return new Promise((resolve) => {
    chrome.storage.sync.set({
      devModeEnabled: false,
      selectedEnvironment: DEFAULT_ENVIRONMENT
    }, resolve);
  });
}

/**
 * Set environment
 * @param {string} environment - dev/staging/prod
 * @returns {Promise<void>}
 */
async function setEnvironment(environment) {
  if (!ENVIRONMENTS[environment]) {
    throw new Error(`Invalid environment: ${environment}`);
  }
  return new Promise((resolve) => {
    chrome.storage.sync.set({
      selectedEnvironment: environment
    }, resolve);
  });
}

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ENVIRONMENTS,
    DEFAULT_ENVIRONMENT,
    getCurrentEnvironment,
    getEnvironmentName,
    isDevModeEnabled,
    validateDevModePassword,
    enableDevMode,
    disableDevMode,
    setEnvironment
  };
}
