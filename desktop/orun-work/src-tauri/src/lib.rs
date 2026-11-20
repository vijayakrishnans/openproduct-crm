/// The agent's key may come from the environment the app was started in, so
/// a key already exported for other tools works without pasting it again.
#[tauri::command]
fn anthropic_key_from_env() -> Option<String> {
    std::env::var("ANTHROPIC_API_KEY").ok().filter(|k| !k.trim().is_empty())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![anthropic_key_from_env])
        .run(tauri::generate_context!())
        .expect("error while running Orun Work");
}
