use std::path::Path;
use std::sync::Arc;

/// Rasterize an SVG string to a tiny-skia pixmap at `scale`.
fn render_pixmap(svg: &str, scale: f32) -> Result<resvg::tiny_skia::Pixmap, String> {
    let scale = scale.clamp(0.1, 8.0);

    // Build font database (needed for text elements).
    let mut fontdb = resvg::usvg::fontdb::Database::new();
    fontdb.load_system_fonts();

    let opt = resvg::usvg::Options {
        fontdb: Arc::new(fontdb),
        ..Default::default()
    };
    let tree = resvg::usvg::Tree::from_str(svg, &opt)
        .map_err(|e| format!("SVG parse error: {e}"))?;

    let w = (tree.size().width() * scale).ceil() as u32;
    let h = (tree.size().height() * scale).ceil() as u32;
    if w == 0 || h == 0 {
        return Err("SVG has zero dimensions".into());
    }
    if w > 16_384 || h > 16_384 {
        return Err(format!("Output size {w}×{h} exceeds the 16 384 px limit"));
    }

    let mut pixmap = resvg::tiny_skia::Pixmap::new(w, h)
        .ok_or_else(|| "Failed to allocate image buffer".to_string())?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    Ok(pixmap)
}

/// Render an SVG string to a PNG file at `path` (2× retina by default).
#[tauri::command]
pub async fn export_png(svg_content: String, path: String, scale: f32) -> Result<(), String> {
    let pixmap = render_pixmap(&svg_content, scale)?;
    pixmap
        .save_png(Path::new(&path))
        .map_err(|e| format!("PNG write error: {e}"))
}

/// Render an SVG to PNG or JPEG. JPEG has no alpha → composited over white.
#[tauri::command]
pub async fn export_image(
    svg_content: String,
    path: String,
    scale: f32,
    format: String,
) -> Result<(), String> {
    let pixmap = render_pixmap(&svg_content, scale)?;

    match format.as_str() {
        "png" => pixmap
            .save_png(Path::new(&path))
            .map_err(|e| format!("PNG write error: {e}")),
        "jpeg" | "jpg" => {
            let (w, h) = (pixmap.width(), pixmap.height());
            // Composite premultiplied RGBA over a white background → opaque RGB.
            let mut rgb = Vec::with_capacity((w * h * 3) as usize);
            for px in pixmap.pixels() {
                let bg = 255 - px.alpha() as u16;
                rgb.push((px.red() as u16 + bg).min(255) as u8);
                rgb.push((px.green() as u16 + bg).min(255) as u8);
                rgb.push((px.blue() as u16 + bg).min(255) as u8);
            }
            let img = image::RgbImage::from_raw(w, h, rgb)
                .ok_or_else(|| "Failed to build image buffer".to_string())?;
            img.save(Path::new(&path))
                .map_err(|e| format!("JPEG write error: {e}"))
        }
        other => Err(format!("Unsupported export format: {other}")),
    }
}

/// Render an SVG to a vector PDF (svg2pdf — text stays selectable, no rasterizing).
#[tauri::command]
pub async fn export_pdf(svg_content: String, path: String) -> Result<(), String> {
    let mut options = svg2pdf::usvg::Options::default();
    options.fontdb_mut().load_system_fonts();
    let tree = svg2pdf::usvg::Tree::from_str(&svg_content, &options)
        .map_err(|e| format!("SVG parse error: {e}"))?;
    let pdf = svg2pdf::to_pdf(
        &tree,
        svg2pdf::ConversionOptions::default(),
        svg2pdf::PageOptions::default(),
    )
    .map_err(|e| format!("PDF conversion error: {e}"))?;
    std::fs::write(Path::new(&path), pdf).map_err(|e| format!("PDF write error: {e}"))
}
