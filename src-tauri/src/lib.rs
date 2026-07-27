use std::fs;

#[tauri::command]
fn save_html_file(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|error| format!("无法保存文件：{error}"))
}

#[cfg(test)]
mod tests {
    use super::save_html_file;

    #[test]
    fn saves_exported_html_to_disk() {
        let path = std::env::temp_dir().join(format!(
            "homepage-forge-export-test-{}.html",
            std::process::id()
        ));
        let content = "<!doctype html><title>测试主页</title>";

        save_html_file(path.to_string_lossy().into_owned(), content.into()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
        std::fs::remove_file(path).unwrap();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_html_file])
        .run(tauri::generate_context!())
        .expect("启动主页工坊失败")
}
