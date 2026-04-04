use std::path::Path;

/// Read an SVG file from disk and return its contents as a UTF-8 string.
#[tauri::command]
pub async fn open_svg_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(Path::new(&path)).map_err(|e| e.to_string())
}

/// Write an SVG string to disk at the given path.
#[tauri::command]
pub async fn save_svg_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(Path::new(&path), content).map_err(|e| e.to_string())
}
