fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "get_download_folder",
                "choose_download_folder",
                "open_download_folder",
                "open_google_flow",
                "prepare_workspace",
                "preload_workspace",
                "close_workspaces",
                "navigate_service_bookmark",
                "close_google_flow",
                "resize_google_flow",
                "remove_google_flow_account",
                "clear_google_flow_cache",
                "begin_blob_download",
                "write_blob_download_chunk",
                "complete_blob_download",
                "cancel_blob_download",
                "debug_trigger_isolated_dialog",
                "load_accounts",
                "save_accounts",
            ]),
        ),
    )
    .expect("failed to run Tauri build script")
}
