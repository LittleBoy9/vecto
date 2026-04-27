use futures_util::StreamExt;
use tauri::Emitter;

const SYSTEM_PROMPT: &str = r#"You are an expert SVG designer and engineer. Your only job is to produce clean, well-structured SVG markup.

RULES — follow every one precisely:
1. Output ONLY the raw SVG — no markdown fences, no explanation, no commentary before or after.
2. Start your response with `<svg` and end with `</svg>`. Nothing else.
3. Always include: xmlns="http://www.w3.org/2000/svg" and a viewBox attribute.
4. Set explicit width and height on the root <svg> (e.g. width="400" height="400").
5. Use ONLY presentation attributes for styling (fill, stroke, stroke-width, opacity, etc.).
   Do NOT use <style> blocks, CSS classes, or inline style="" attributes.
6. Group related elements with <g id="descriptive-name"> — every group must have a meaningful id.
7. Prefer simple geometric primitives: <rect>, <circle>, <ellipse>, <path>, <line>, <polygon>.
8. All paths must use absolute coordinates. Keep path data clean and readable.
9. Do NOT reference external files, fonts, or URLs. Fully self-contained only.
10. No <script> tags, no event handlers, no animations (no <animate> or <animateTransform>).
11. Use a coherent, intentional color palette. Avoid pure black (#000) backgrounds.
12. Produce artwork that is visually complete and polished — not a rough sketch.

STYLE GUIDANCE:
- Aim for clean, modern, flat or semi-flat illustration style.
- Use layering (elements drawn back-to-front) to create depth.
- Add subtle details (highlights, shadows using opacity, secondary shapes) to make it feel real.
- Center the composition within the viewBox with appropriate padding."#;

fn user_message(prompt: &str) -> String {
    format!(
        "Create an SVG illustration of: {}\n\nRemember: output ONLY the raw SVG markup, starting with <svg and ending with </svg>.",
        prompt.trim()
    )
}

// ── Non-streaming fallback (Anthropic only) ───────────────────────────────────

#[tauri::command]
pub async fn generate_svg(prompt: String, api_key: String) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("No API key set. Add your Anthropic API key in Settings.".to_string());
    }

    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": "claude-sonnet-4-6",
        "max_tokens": 8000,
        "system": SYSTEM_PROMPT,
        "messages": [{ "role": "user", "content": user_message(&prompt) }]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key.trim())
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    let status = response.status();
    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse API response: {e}"))?;

    if !status.is_success() {
        let msg = json["error"]["message"].as_str().unwrap_or("Unknown API error");
        return Err(format!("Claude API error ({status}): {msg}"));
    }

    let raw = json["content"][0]["text"].as_str().ok_or("Empty response from Claude")?;
    extract_svg(raw)
        .ok_or_else(|| "Claude did not return valid SVG markup. Try rephrasing your prompt.".to_string())
}

// ── Streaming (all providers) ─────────────────────────────────────────────────

#[tauri::command]
pub async fn generate_svg_stream(
    prompt: String,
    api_key: String,
    provider: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err(format!(
            "No API key set for {}. Add it in Settings.",
            provider
        ));
    }
    match provider.as_str() {
        "anthropic" => stream_anthropic(prompt, api_key, app_handle).await,
        "openai"    => stream_openai(prompt, api_key, app_handle).await,
        "gemini"    => stream_gemini(prompt, api_key, app_handle).await,
        _           => Err(format!("Unknown provider: {provider}")),
    }
}

// ── Anthropic ─────────────────────────────────────────────────────────────────

async fn stream_anthropic(
    prompt: String,
    api_key: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": "claude-sonnet-4-6",
        "max_tokens": 8000,
        "stream": true,
        "system": SYSTEM_PROMPT,
        "messages": [{ "role": "user", "content": user_message(&prompt) }]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key.trim())
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    check_error_status(response, |json| {
        json["error"]["message"].as_str().unwrap_or("Unknown error").to_string()
    })
    .await?
    .pipe_sse(app_handle, |json| {
        if json["type"] == "content_block_delta" && json["delta"]["type"] == "text_delta" {
            json["delta"]["text"].as_str().map(str::to_string)
        } else {
            None
        }
    })
    .await
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

async fn stream_openai(
    prompt: String,
    api_key: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": "gpt-4o",
        "max_tokens": 4096,
        "stream": true,
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT },
            { "role": "user",   "content": user_message(&prompt) }
        ]
    });

    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    check_error_status(response, |json| {
        json["error"]["message"].as_str().unwrap_or("Unknown error").to_string()
    })
    .await?
    .pipe_sse(app_handle, |json| {
        json["choices"][0]["delta"]["content"].as_str().map(str::to_string)
    })
    .await
}

// ── Gemini ────────────────────────────────────────────────────────────────────

async fn stream_gemini(
    prompt: String,
    api_key: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key={}",
        api_key.trim()
    );
    let body = serde_json::json!({
        "systemInstruction": { "parts": [{ "text": SYSTEM_PROMPT }] },
        "contents": [{ "role": "user", "parts": [{ "text": user_message(&prompt) }] }],
        "generationConfig": { "maxOutputTokens": 8192 }
    });

    let response = client
        .post(&url)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    check_error_status(response, |json| {
        json["error"]["message"].as_str().unwrap_or("Unknown error").to_string()
    })
    .await?
    .pipe_sse(app_handle, |json| {
        json["candidates"][0]["content"]["parts"][0]["text"]
            .as_str()
            .map(str::to_string)
    })
    .await
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

struct StreamingResponse(reqwest::Response);

/// Check HTTP status. If not 2xx, read body as JSON and extract error message.
async fn check_error_status(
    response: reqwest::Response,
    extract_msg: impl Fn(&serde_json::Value) -> String,
) -> Result<StreamingResponse, String> {
    if response.status().is_success() {
        return Ok(StreamingResponse(response));
    }
    let status = response.status();
    let json: serde_json::Value = response
        .json()
        .await
        .unwrap_or(serde_json::Value::Null);
    Err(format!("API error ({status}): {}", extract_msg(&json)))
}

impl StreamingResponse {
    /// Drain SSE lines, call `extract_text` on each parsed JSON data payload,
    /// and emit non-None results as `svg:chunk` Tauri events.
    async fn pipe_sse(
        self,
        app_handle: tauri::AppHandle,
        extract_text: impl Fn(&serde_json::Value) -> Option<String>,
    ) -> Result<(), String> {
        let mut stream = self.0.bytes_stream();
        let mut buf = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Stream read error: {e}"))?;
            buf.push_str(&String::from_utf8_lossy(&chunk));

            loop {
                match buf.find('\n') {
                    None => break,
                    Some(pos) => {
                        let line = buf[..pos].trim_end_matches('\r').trim().to_string();
                        buf = buf[pos + 1..].to_string();

                        if !line.starts_with("data: ") {
                            continue;
                        }
                        let data = &line[6..];
                        if data == "[DONE]" {
                            return Ok(());
                        }
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                            if let Some(text) = extract_text(&json) {
                                let _ = app_handle.emit("svg:chunk", text);
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }
}

// ── SVG extraction ────────────────────────────────────────────────────────────

fn extract_svg(text: &str) -> Option<String> {
    let text = text.trim();
    let text = if text.starts_with("```") {
        let after = text.find('\n').map(|i| &text[i + 1..]).unwrap_or(text);
        if let Some(end) = after.rfind("```") { after[..end].trim() } else { after.trim() }
    } else {
        text
    };
    let start = text.find("<svg")?;
    let end = text.rfind("</svg>").map(|i| i + "</svg>".len())?;
    if start >= end { return None; }
    Some(text[start..end].to_string())
}

