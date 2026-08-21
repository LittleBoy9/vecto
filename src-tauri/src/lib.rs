mod commands;

use commands::ai::{cancel_ai, edit_svg_stream, generate_svg_stream, generate_svg_variants};
use commands::export::{export_image, export_pdf, export_png};
use commands::fs_commands::{open_svg_file, save_svg_file};
use commands::trace::trace_image;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Only the dialog plugin is used from the frontend. The fs and shell
        // plugins were registered but never imported in src/ — all file IO goes
        // through the open_svg_file / save_svg_file commands below — so their
        // unscoped capabilities were pure standing blast radius for an app whose
        // whole job is ingesting untrusted SVG.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Updater is desktop-only, so it is registered here rather than in
            // the unconditional plugin chain above.
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            generate_svg_stream,
            generate_svg_variants,
            edit_svg_stream,
            cancel_ai,
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
