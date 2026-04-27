use std::path::Path;
use std::sync::Arc;

/// Render an SVG string to a PNG file at `path`.
///
/// `scale` controls output resolution:
///   1.0 = 1px per SVG unit (screen resolution)
///   2.0 = 2x / retina — recommended default
///   3.0 = 3x for high-DPI print
///
/// Uses resvg → tiny-skia for rasterisation. Fonts are loaded from the
/// system font database so <text> elements render correctly.
#[tauri::command]
pub async fn export_png(svg_content: String, path: String, scale: f32) -> Result<(), String> {
    let scale = scale.clamp(0.1, 8.0);

    // Build font database (needed for text elements)
    let mut fontdb = resvg::usvg::fontdb::Database::new();
    fontdb.load_system_fonts();

    let opt = resvg::usvg::Options {
        fontdb: Arc::new(fontdb),
        ..Default::default()
    };

    // Parse SVG
    let tree = resvg::usvg::Tree::from_str(&svg_content, &opt)
        .map_err(|e| format!("SVG parse error: {e}"))?;

    // Compute output dimensions
    let w = (tree.size().width()  * scale).ceil() as u32;
    let h = (tree.size().height() * scale).ceil() as u32;

    if w == 0 || h == 0 {
        return Err("SVG has zero dimensions".into());
    }
    if w > 16_384 || h > 16_384 {
        return Err(format!("Output size {w}×{h} exceeds the 16 384 px limit"));
    }

    // Allocate pixel buffer and render
    let mut pixmap = resvg::tiny_skia::Pixmap::new(w, h)
        .ok_or_else(|| "Failed to allocate image buffer".to_string())?;

    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );

    // Encode and write PNG
    pixmap
        .save_png(Path::new(&path))
        .map_err(|e| format!("PNG write error: {e}"))?;

    Ok(())
}
