//! Embedder for vector search

use async_trait::async_trait;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum EmbedError {
    #[error("API error: {0}")]
    Api(String),

    #[error("Model error: {0}")]
    Model(String),

    #[error("JSON parse error: {0}")]
    Parse(#[from] serde_json::Error),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
}

/// Embedder trait
#[async_trait]
pub trait Embedder: Send + Sync {
    /// Generate embedding for a single text
    async fn embed(&self, text: &str) -> Result<Vec<f32>, EmbedError>;

    /// Generate embeddings for multiple texts
    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError>;
}

/// OpenAI-compatible embedder
pub struct OpenAIEmbedder {
    client: reqwest::Client,
    api_url: String,
    model: String,
    dimensions: Option<usize>,
}

impl OpenAIEmbedder {
    pub fn new(api_url: String, model: String, dimensions: Option<usize>) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_url,
            model,
            dimensions,
        }
    }

    /// Normalize embedding using L2 norm
    fn l2_normalize(vec: &[f32]) -> Vec<f32> {
        let norm: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            vec.iter().map(|x| x / norm).collect()
        } else {
            vec.to_vec()
        }
    }
}

#[async_trait]
impl Embedder for OpenAIEmbedder {
    async fn embed(&self, text: &str) -> Result<Vec<f32>, EmbedError> {
        let embeddings = self.embed_batch(&[text.to_string()]).await?;
        Ok(embeddings.into_iter().next().unwrap_or_default())
    }

    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        let mut body = serde_json::json!({
            "model": self.model,
            "input": texts,
        });

        if let Some(dims) = self.dimensions {
            body["dimensions"] = serde_json::json!(dims);
        }

        let response = self.client.post(&self.api_url).json(&body).send().await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(EmbedError::Api(format!(
                "API returned {}: {}",
                status, text
            )));
        }

        let data: serde_json::Value = response.json().await?;

        let embeddings: Vec<Vec<f32>> = data["data"]
            .as_array()
            .ok_or_else(|| {
                EmbedError::Parse(serde_json::from_str::<serde_json::Value>("{}").unwrap_err())
            })?
            .iter()
            .filter_map(|item| item["embedding"].as_array())
            .map(|arr| {
                let vec: Vec<f32> = arr
                    .iter()
                    .filter_map(|v| v.as_f64())
                    .map(|f| f as f32)
                    .collect();
                Self::l2_normalize(&vec)
            })
            .collect();

        Ok(embeddings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_l2_normalize() {
        let vec = vec![3.0, 4.0];
        let normalized = OpenAIEmbedder::l2_normalize(&vec);
        let norm: f32 = normalized.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 0.0001);
    }
}
