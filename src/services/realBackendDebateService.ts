/**
 * Real Backend Debate Service
 * 
 * Communicates with the external Python backend (e.g. Agent.py running via FastAPI).
 * Reads base URL from import.meta.env.VITE_API_BASE_URL.
 * 
 * IMPORTANT:
 * - This service does not invent endpoints or fabricate backend responses.
 * - When VITE_API_BASE_URL is not set, or when the team's specific endpoint path has
 *   not yet been specified, this service returns explicit typed errors rather than
 *   masking failures or pretending a connection succeeded.
 * - Backend failures are surfaced as real errors, NEVER converted into fake agent messages.
 * - No Groq API keys are stored or exposed in this frontend code.
 */

import { DebateSession } from '../types/debate';
import { 
  StartDebatePayload, 
  BackendIntegrationError, 
  IDebateService 
} from './debateService.types';

// =============================================================================
// BACKEND INTEGRATION CONFIGURATION
// Configure these constants when your team provides the actual Python endpoint
// =============================================================================

/**
 * When your Python team supplies the exact route from Agent.py, set it here.
 * Set to null by default so we do NOT invent an endpoint.
 * Example once provided by team: '/api/v1/debate' or '/debate'
 */
export const ACTUAL_BACKEND_ENDPOINT: string | null = null;

class RealBackendDebateService implements IDebateService {
  private inMemorySessions: Map<string, DebateSession> = new Map();

  /**
   * Returns the configured backend base URL from VITE_API_BASE_URL, trimmed of trailing slash.
   */
  public getBaseUrl(): string | null {
    const rawUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
    if (!rawUrl) return null;
    return rawUrl.replace(/\/+$/, '');
  }

  /**
   * Returns true if a valid non-empty VITE_API_BASE_URL is configured.
   */
  public isBackendConfigured(): boolean {
    const url = this.getBaseUrl();
    return !!url && url.length > 0;
  }

  /**
   * Starts a debate on the real backend.
   * Handles:
   * 1. Missing base URL configuration
   * 2. Unspecified endpoint path (waiting on team schema)
   * 3. Network connection errors
   * 4. HTTP error codes (4xx, 5xx)
   * 5. Invalid/malformed response payloads
   */
  public async startDebate(payload: StartDebatePayload): Promise<DebateSession> {
    const baseUrl = this.getBaseUrl();

    if (!baseUrl) {
      throw new BackendIntegrationError({
        type: 'missing_config',
        message: 'Backend URL is not configured. Set VITE_API_BASE_URL in your environment to connect to your team\'s Python server.',
      });
    }

    if (!ACTUAL_BACKEND_ENDPOINT) {
      throw new BackendIntegrationError({
        type: 'unimplemented_endpoint',
        message: `Backend base URL is set to "${baseUrl}", but your team has not yet provided the exact endpoint path and request/response schema. Once provided, configure ACTUAL_BACKEND_ENDPOINT in src/services/realBackendDebateService.ts.`,
        details: 'Awaiting team backend route specification (e.g. POST /debate).',
      });
    }

    const fullUrl = `${baseUrl}${ACTUAL_BACKEND_ENDPOINT}`;

    let response: Response;
    try {
      response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (networkError: unknown) {
      const err = networkError instanceof Error ? networkError : new Error(String(networkError));
      throw new BackendIntegrationError({
        type: 'network_failure',
        message: `Unable to connect to backend at ${fullUrl}. Check that your Python backend (Agent.py) is running and accessible.`,
        details: err.message,
      });
    }

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // Ignore failure to read error body
      }

      throw new BackendIntegrationError({
        type: 'http_error',
        status: response.status,
        statusText: response.statusText,
        message: `Backend returned HTTP ${response.status} (${response.statusText}).`,
        details: errorBody || undefined,
      });
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new BackendIntegrationError({
        type: 'invalid_response',
        message: 'Backend returned a response that could not be parsed as JSON.',
      });
    }

    // Validate that response contains required debate session fields
    if (!this.isValidDebateSession(data)) {
      throw new BackendIntegrationError({
        type: 'invalid_response',
        message: 'Backend returned JSON, but it does not match the DebateSession schema expected by the frontend.',
        details: 'The response is missing required fields (id, question, transcript, etc.).',
      });
    }

    this.inMemorySessions.set(data.id, data);
    return data;
  }

  public getSession(id: string): DebateSession | null {
    return this.inMemorySessions.get(id) || null;
  }

  public getAllSessions(): DebateSession[] {
    return Array.from(this.inMemorySessions.values());
  }

  /**
   * Runtime type guard to ensure response conforms to DebateSession contract
   */
  private isValidDebateSession(obj: unknown): obj is DebateSession {
    if (!obj || typeof obj !== 'object') return false;
    const s = obj as Partial<DebateSession>;
    return (
      typeof s.id === 'string' &&
      typeof s.question === 'string' &&
      Array.isArray(s.transcript) &&
      typeof s.totalRounds === 'number'
    );
  }
}

export const realBackendDebateService = new RealBackendDebateService();
