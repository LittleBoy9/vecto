/// Generate SVG from a natural language prompt via Claude API.
///
/// The `api_key` is provided by the frontend from the user's saved settings.
/// It is used for this request only — Rust never stores it to disk.
#[tauri::command]
pub async fn generate_svg(prompt: String, api_key: String) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("No API key set. Add your Anthropic API key in Settings.".to_string());
    }

    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "model": "claude-opus-4-6",
        "max_tokens": 4096,
        "system": "You are an SVG generation expert. Return ONLY valid SVG markup — no explanation, no markdown fences, no surrounding text. Requirements:\n- Must have a viewBox attribute\n- Use attribute-based styling only (no inline <style> blocks)\n- Clean, logical element grouping with <g> elements\n- Descriptive id attributes on groups\n- Fully self-contained (no external references)",
        "messages": [
            { "role": "user", "content": prompt }
        ]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key.trim())
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    let status = response.status();
    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    if !status.is_success() {
        let msg = json["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        return Err(format!("API error ({status}): {msg}"));
    }

    let svg = json["content"][0]["text"]
        .as_str()
        .ok_or("No text content in API response")?
        .trim()
        .to_string();

    // Basic sanity check — response must look like SVG
    if !svg.contains("<svg") {
        return Err("API response did not contain valid SVG markup".to_string());
    }

    Ok(svg)
}
