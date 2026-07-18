use std::path::Path;

/// Trace a raster image (PNG/JPG/…) into an editable SVG using vtracer.
/// Runs on a blocking thread since tracing is CPU-heavy.
#[tauri::command]
pub async fn trace_image(input_path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let out = std::env::temp_dir().join("vecto-trace.svg");
        let config = vtracer::Config::default();
        vtracer::convert_image_to_svg(Path::new(&input_path), &out, config)
            .map_err(|e| format!("Trace failed: {e}"))?;
        let svg = std::fs::read_to_string(&out).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&out);
        Ok::<String, String>(svg)
    })
    .await
    .map_err(|e| format!("Trace task failed: {e}"))?
}
