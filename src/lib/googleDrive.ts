import { getAppSettingsSnapshot } from '../contexts/AppSettingsContext';

const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const DRIVE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

type GoogleTokenResponse = {
  access_token: string;
  error?: string;
  error_description?: string;
};

type GoogleTokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void;
};

type GoogleAccounts = {
  oauth2: {
    initTokenClient: (config: {
      client_id: string;
      scope: string;
      callback: (response: GoogleTokenResponse) => void;
      error_callback?: (error: { type: string }) => void;
    }) => GoogleTokenClient;
  };
};

declare global {
  interface Window {
    google?: {
      accounts?: GoogleAccounts;
    };
  }
}

export type GoogleDriveUploadResult = {
  id: string;
  name: string;
  webViewLink?: string;
};

let googleScriptPromise: Promise<void> | null = null;
let cachedAccessToken: string | null = null;

const loadGoogleIdentityScript = () => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Drive backup is only available in the browser.'));
  }

  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  if (googleScriptPromise) {
    return googleScriptPromise;
  }

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Unable to load Google Identity Services.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = GOOGLE_IDENTITY_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Unable to load Google Identity Services.'));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
};

const getGoogleClientId = () => {
  const settingsClientId = getAppSettingsSnapshot().google_drive_client_id?.trim();
  const clientId = settingsClientId || import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID;
  if (!clientId) {
    throw new Error('Missing Google Drive Client ID. Add it in Settings before using Drive backups.');
  }
  return clientId;
};

export const authenticateGoogleDrive = async (forcePrompt = false) => {
  await loadGoogleIdentityScript();

  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services did not initialize correctly.');
  }

  if (cachedAccessToken && !forcePrompt) {
    return cachedAccessToken;
  }

  const clientId = getGoogleClientId();

  return new Promise<string>((resolve, reject) => {
    const googleOAuth = window.google?.accounts?.oauth2;
    if (!googleOAuth) {
      reject(new Error('Google Identity Services did not initialize correctly.'));
      return;
    }

    const tokenClient = googleOAuth.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || 'Google authentication failed.'));
          return;
        }

        cachedAccessToken = response.access_token;
        resolve(response.access_token);
      },
      error_callback: (error) => {
        reject(new Error(error.type === 'popup_closed' ? 'Google sign-in was closed before it finished.' : 'Google authentication failed.'));
      },
    });

    tokenClient.requestAccessToken({ prompt: forcePrompt ? 'consent' : '' });
  });
};

export const uploadJsonBackupToGoogleDrive = async ({
  filename,
  jsonContent,
}: {
  filename: string;
  jsonContent: string;
}) => {
  const accessToken = await authenticateGoogleDrive();
  const metadata = {
    name: filename,
    mimeType: 'application/json',
  };
  const boundary = `backup_${Date.now()}`;
  const requestBody = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    jsonContent,
    `--${boundary}--`,
  ].join('\r\n');

  const response = await fetch(DRIVE_UPLOAD_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: requestBody,
  });

  if (response.status === 401) {
    cachedAccessToken = null;
    throw new Error('Google authorization expired. Please try the backup again.');
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Google Drive upload failed.');
  }

  return await response.json() as GoogleDriveUploadResult;
};
