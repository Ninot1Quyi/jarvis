//! MiniMax API client

use reqwest::Client;
use serde::{Deserialize, Serialize};

/// MiniMax API client
pub struct MiniMaxClient {
    client: Client,
    api_key: String,
    base_url: String,
}

impl MiniMaxClient {
    /// Create a new MiniMax API client
    pub fn new(api_key: String, base_url: String) -> Result<Self, crate::voice::VoiceError> {
        if api_key.is_empty() {
            return Err(crate::VoiceError::Api("API key is required".to_string()));
        }

        let client = Client::builder()
            .rustls_tls()
            .build()
            .map_err(|e| crate::VoiceError::Api(format!("Failed to create HTTP client: {}", e)))?;

        Ok(Self {
            client,
            api_key,
            base_url,
        })
    }

    /// Make a POST request to the MiniMax API
    pub async fn post<R>(
        &self,
        endpoint: &str,
        body: &R,
    ) -> Result<reqwest::Response, crate::VoiceError>
    where
        R: Serialize + std::fmt::Debug,
    {
        let url = format!("{}{}", self.base_url.trim_end_matches('/'), endpoint);

        self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(body)
            .send()
            .await
            .map_err(|e| crate::VoiceError::Api(format!("Request failed: {}", e)))
    }

    /// Get the API key
    pub fn api_key(&self) -> &str {
        &self.api_key
    }
}
