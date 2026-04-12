//! understand_image - Image understanding tool via MiniMax MCP
//!
//! Analyzes and understands images using MiniMax's vision capabilities

use super::McpToolClient;
use crate::tools::{Tool, ToolContext, ToolResult};
use async_trait::async_trait;

/// MiniMax image understanding tool
pub struct MiniMaxUnderstandImage {
    client: McpToolClient,
}

impl MiniMaxUnderstandImage {
    pub fn new() -> Self {
        Self {
            client: McpToolClient::new("understand_image"),
        }
    }
}

impl Default for MiniMaxUnderstandImage {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for MiniMaxUnderstandImage {
    fn name(&self) -> &str {
        "understand_image"
    }

    fn description(&self) -> &str {
        "Analyze and understand images. Supports JPEG, PNG, GIF, WebP (max 20MB). Use this when you need to extract information from images or understand visual content."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "Question or analysis request about the image"
                },
                "image_url": {
                    "type": "string",
                    "description": "Image URL or local file path (HTTP/HTTPS URL or local path)"
                }
            },
            "required": ["prompt", "image_url"]
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        true
    }

    fn is_read_only(&self) -> bool {
        true
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let _prompt = input["prompt"]
            .as_str()
            .ok_or("Missing 'prompt' parameter")?;
        let _image_url = input["image_url"]
            .as_str()
            .ok_or("Missing 'image_url' parameter")?;

        match self.client.execute(input).await {
            Ok(result) => {
                let content = result.content.clone();
                Ok(ToolResult {
                    success: result.success,
                    output: content,
                    error: if result.success {
                        None
                    } else {
                        Some(result.content)
                    },
                })
            }
            Err(e) => Ok(ToolResult {
                success: false,
                output: format!("Image analysis failed: {}", e),
                error: Some(e),
            }),
        }
    }
}
