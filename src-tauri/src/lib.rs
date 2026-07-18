mod commands;

use commands::ai::{
    edit_svg_stream, generate_svg, generate_svg_stream, generate_svg_variants,
};
use commands::export::{export_image, export_pdf, export_png};
use commands::fs_commands::{open_svg_file, save_svg_file};
use commands::trace::trace_image;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            generate_svg,
            generate_svg_stream,
            generate_svg_variants,
            edit_svg_stream,
            export_png,
            export_image,
            export_pdf,
            open_svg_file,
            save_svg_file,
            trace_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vecto");
}
