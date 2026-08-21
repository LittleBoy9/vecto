use futures_util::StreamExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::Emitter;

/// Set by `cancel_ai`, cleared at the start of every request. There is at most
/// one generation in flight at a time (the UI gates on `isGenerating`), so a
/// single flag is enough. Without this there was no way to stop a request:
/// a stalled call left the spinner up forever with no abort and no timeout.
static CANCELLED: AtomicBool = AtomicBool::new(false);

/// Hard ceiling on any single request, so a silently dropped connection can't
/// hang the UI indefinitely even if the user never hits cancel.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(180);

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))
}

fn begin_request() {
    CANCELLED.store(false, Ordering::SeqCst);
}

fn is_cancelled() -> bool {
    CANCELLED.load(Ordering::SeqCst)
}

/// Ask the in-flight generation / edit / variant run to stop.
#[tauri::command]
pub fn cancel_ai() {
    CANCELLED.store(true, Ordering::SeqCst);
}

/// Resolve `fut`, or bail out early if the user cancels. Used for the
/// non-streaming variant fan-out, which otherwise has no cancellation point.
async fn cancellable<T>(fut: impl std::future::Future<Output = T>) -> Option<T> {
    tokio::select! {
        r = fut => Some(r),
        _ = async {
            while !is_cancelled() {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        } => None,
    }
}

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

// ── Non-streaming (single request) ────────────────────────────────────────────

/// One non-streaming completion → extracted `<svg>` string. Used by the
/// single-shot generate and by the variants fan-out.
async fn generate_once(
    provider: &str,
    model: &str,
    system: &str,
    user: String,
    api_key: &str,
) -> Result<String, String> {
    let client = http_client()?;

    let (request, point_to_text): (reqwest::RequestBuilder, fn(&serde_json::Value) -> Option<&str>) =
        match provider {
            "anthropic" => (
                client
                    .post("https://api.anthropic.com/v1/messages")
                    .header("x-api-key", api_key.trim())
                    .header("anthropic-version", "2023-06-01")
                    .header("content-type", "application/json")
                    .json(&serde_json::json!({
                        "model": model,
                        "max_tokens": 8000,
                        "system": system,
                        "messages": [{ "role": "user", "content": user }]
                    })),
                |j| j["content"][0]["text"].as_str(),
            ),
            "openai" => (
                client
                    .post("https://api.openai.com/v1/chat/completions")
                    .header("Authorization", format!("Bearer {}", api_key.trim()))
                    .header("content-type", "application/json")
                    .json(&serde_json::json!({
                        "model": model,
                        "max_tokens": 4096,
                        "messages": [
                            { "role": "system", "content": system },
                            { "role": "user",   "content": user }
                        ]
                    })),
                |j| j["choices"][0]["message"]["content"].as_str(),
            ),
            "gemini" => (
                client
                    .post(format!(
                        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                        model.trim(),
                        api_key.trim()
                    ))
                    .header("content-type", "application/json")
                    .json(&serde_json::json!({
                        "systemInstruction": { "parts": [{ "text": system }] },
                        "contents": [{ "role": "user", "parts": [{ "text": user }] }],
                        "generationConfig": { "maxOutputTokens": 8192 }
                    })),
                |j| j["candidates"][0]["content"]["parts"][0]["text"].as_str(),
            ),
            _ => return Err(format!("Unknown provider: {provider}")),
        };

    let response = request.send().await.map_err(|e| format!("Network error: {e}"))?;
    let status = response.status();
    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse API response: {e}"))?;

    if !status.is_success() {
        let msg = json["error"]["message"].as_str().unwrap_or("Unknown API error");
        return Err(format!("API error ({status}): {msg}"));
    }

    let raw = point_to_text(&json).ok_or("Empty response from the model")?;
    extract_svg(raw).ok_or_else(|| "The model did not return valid SVG markup.".to_string())
}

/// Generate several independent SVG variants of the same prompt, concurrently.
#[tauri::command]
pub async fn generate_svg_variants(
    prompt: String,
    api_key: String,
    provider: String,
    model: String,
    count: u32,
) -> Result<Vec<String>, String> {
    if api_key.trim().is_empty() {
        return Err(format!("No API key set for {}. Add it in Settings.", provider));
    }
    begin_request();
    let n = count.clamp(1, 6);
    let user = user_message(&prompt);
    let tasks = (0..n).map(|_| generate_once(&provider, &model, SYSTEM_PROMPT, user.clone(), &api_key));

    // join_all has no cancellation point of its own — one stalled request used
    // to block the whole batch with no way out.
    let results = match cancellable(futures_util::future::join_all(tasks)).await {
        Some(r) => r,
        None => return Ok(Vec::new()), // cancelled by the user — not an error
    };

    let svgs: Vec<String> = results.into_iter().filter_map(Result::ok).collect();
    if svgs.is_empty() {
        return Err("No variants were generated. Check your API key and try again.".to_string());
    }
    Ok(svgs)
}

// ── Edit prompt (selection-scoped AI edit) ────────────────────────────────────

const EDIT_SYSTEM_PROMPT: &str = r#"You are an expert SVG editor. You receive an SVG fragment and an instruction describing a change. Apply ONLY the requested change and return the COMPLETE edited SVG.

RULES — follow every one precisely:
1. Output ONLY raw SVG — start with `<svg` and end with `</svg>`. No markdown fences, no explanation.
2. Keep the same viewBox. Keep every element's `id` attribute EXACTLY as given — even on elements you modify — so they can be matched back. Return the SAME number of top-level elements with the SAME ids; do not add, remove, split, or merge elements. Preserve elements you are not asked to change.
3. Use ONLY presentation attributes (fill, stroke, stroke-width, opacity, transform, etc.). No <style> blocks, no CSS classes, no inline style="".
4. Keep coordinates absolute and path data clean.
5. Return the same set of top-level elements you were given, with the instruction applied — do not add an outer wrapper group unless explicitly asked.
6. Gradients: if a <defs> with gradients is given, keep it (same ids) and the fill="url(#id)" references. You MAY edit gradient stops/colors, or add a new <defs> gradient and reference it, when that fulfils the instruction."#;

fn edit_user_message(instruction: &str, svg: &str) -> String {
    format!(
        "Here is the current SVG:\n\n{}\n\nInstruction: {}\n\nReturn the COMPLETE edited SVG, starting with <svg and ending with </svg>.",
        svg.trim(),
        instruction.trim()
    )
}

// ── Streaming commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn generate_svg_stream(
    prompt: String,
    api_key: String,
    provider: String,
    model: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err(format!("No API key set for {}. Add it in Settings.", provider));
    }
    begin_request();
    stream_provider(
        &provider, &model, SYSTEM_PROMPT, user_message(&prompt), api_key, app_handle, "svg:chunk",
    )
    .await
}

#[tauri::command]
pub async fn edit_svg_stream(
    instruction: String,
    svg: String,
    api_key: String,
    provider: String,
    model: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err(format!("No API key set for {}. Add it in Settings.", provider));
    }
    begin_request();
    stream_provider(
        &provider, &model, EDIT_SYSTEM_PROMPT, edit_user_message(&instruction, &svg),
        api_key, app_handle, "svg:edit-chunk",
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn stream_provider(
    provider: &str,
    model: &str,
    system: &str,
    user: String,
    api_key: String,
    app_handle: tauri::AppHandle,
    event: &'static str,
) -> Result<(), String> {
    match provider {
        "anthropic" => stream_anthropic(model, system, user, api_key, app_handle, event).await,
        "openai"    => stream_openai(model, system, user, api_key, app_handle, event).await,
        "gemini"    => stream_gemini(model, system, user, api_key, app_handle, event).await,
        _           => Err(format!("Unknown provider: {provider}")),
    }
}

// ── Anthropic ─────────────────────────────────────────────────────────────────

async fn stream_anthropic(
    model: &str,
    system: &str,
    user: String,
    api_key: String,
    app_handle: tauri::AppHandle,
    event: &'static str,
) -> Result<(), String> {
    let client = http_client()?;
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 8000,
        "stream": true,
        "system": system,
        "messages": [{ "role": "user", "content": user }]
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
    .pipe_sse(app_handle, event, |json| {
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
    model: &str,
    system: &str,
    user: String,
    api_key: String,
    app_handle: tauri::AppHandle,
    event: &'static str,
) -> Result<(), String> {
    let client = http_client()?;
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "stream": true,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user",   "content": user }
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
    .pipe_sse(app_handle, event, |json| {
        json["choices"][0]["delta"]["content"].as_str().map(str::to_string)
    })
    .await
}

// ── Gemini ────────────────────────────────────────────────────────────────────

async fn stream_gemini(
    model: &str,
    system: &str,
    user: String,
    api_key: String,
    app_handle: tauri::AppHandle,
    event: &'static str,
) -> Result<(), String> {
    let client = http_client()?;
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
        model.trim(),
        api_key.trim()
    );
    let body = serde_json::json!({
        "systemInstruction": { "parts": [{ "text": system }] },
        "contents": [{ "role": "user", "parts": [{ "text": user }] }],
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
    .pipe_sse(app_handle, event, |json| {
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
        event: &'static str,
        extract_text: impl Fn(&serde_json::Value) -> Option<String>,
    ) -> Result<(), String> {
        let mut stream = self.0.bytes_stream();
        let mut buf = String::new();

        while let Some(chunk) = stream.next().await {
            // Cancellation point: stop draining and drop the connection.
            if is_cancelled() {
                return Ok(());
            }
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
                            // An error event can arrive after a 200 OK (overload,
                            // rate limit mid-stream). Surface it instead of hanging
                            // on a half-finished render.
                            if json["type"] == "error" || json["error"].is_object() {
                                let msg = json["error"]["message"]
                                    .as_str()
                                    .unwrap_or("stream error");
                                return Err(format!("API stream error: {msg}"));
                            }
                            if let Some(text) = extract_text(&json) {
                                let _ = app_handle.emit(event, text);
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

