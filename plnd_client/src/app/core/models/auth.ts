/** Sent to the backend to exchange an IdP ID token for a backend JWT. */
export interface TokenExchangeRequest {
  id_token: string;
  /** The IdP provider name: "mock" | "google" | "apple" */
  provider: string;
}

/** Response from the backend token exchange endpoint. */
export interface TokenExchangeResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}
